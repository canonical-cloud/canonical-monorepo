import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.ByteBuffer;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

public final class NioSingleCarrierCanary {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static final class Reactor implements AutoCloseable {
        private final Selector selector;
        private final ArrayBlockingQueue<Runnable> commands = new ArrayBlockingQueue<>(16);
        private final Thread thread;
        private final AtomicBoolean closed = new AtomicBoolean();

        Reactor() throws Exception {
            selector = Selector.open();
            thread = new Thread(() -> {
                try {
                    while (!closed.get()) {
                        Runnable command;
                        while ((command = commands.poll()) != null) command.run();
                        selector.select(1000);
                        var keys = selector.selectedKeys().iterator();
                        while (keys.hasNext()) {
                            var key = keys.next();
                            keys.remove();
                            var ready = (Runnable) key.attachment();
                            key.cancel();
                            selector.selectNow();
                            ready.run();
                        }
                    }
                } catch (Throwable failure) {
                    failure.printStackTrace(System.err);
                    System.exit(91);
                }
            }, "source-free-nio-reactor");
            thread.setDaemon(true);
            thread.start();
        }

        void watchRead(SocketChannel channel, Runnable ready) throws Exception {
            CountDownLatch registered = new CountDownLatch(1);
            check(commands.offer(() -> {
                try {
                    channel.register(selector, SelectionKey.OP_READ, ready);
                } catch (Exception failure) {
                    throw new RuntimeException(failure);
                } finally {
                    registered.countDown();
                }
            }), "reactor command queue full");
            selector.wakeup();
            check(registered.await(2, TimeUnit.SECONDS), "read watch registration timed out");
        }

        @Override public void close() throws Exception {
            closed.set(true);
            selector.wakeup();
            thread.join(3000);
            check(!thread.isAlive(), "reactor did not terminate");
            selector.close();
        }
    }

    public static void main(String[] args) throws Exception {
        ExecutorService completion = Executors.newSingleThreadExecutor(runnable -> {
            Thread thread = new Thread(runnable, "source-free-single-completion-carrier");
            thread.setDaemon(true);
            return thread;
        });
        try (Reactor reactor = new Reactor();
             ServerSocketChannel listener = ServerSocketChannel.open();
             Socket peer = new Socket()) {
            CountDownLatch warm = new CountDownLatch(1);
            completion.execute(warm::countDown);
            check(warm.await(2, TimeUnit.SECONDS), "completion carrier failed to warm");

            listener.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), 0));
            listener.configureBlocking(false);
            peer.connect(listener.getLocalAddress());

            SocketChannel accepted = null;
            long acceptDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2);
            while (accepted == null && System.nanoTime() < acceptDeadline) {
                accepted = listener.accept();
                if (accepted == null) Thread.onSpinWait();
            }
            check(accepted != null, "loopback accept timed out");
            try (accepted) {
                accepted.configureBlocking(false);
                CountDownLatch ready = new CountDownLatch(1);
                reactor.watchRead(accepted, () -> completion.execute(ready::countDown));

                // The peer is deliberately silent. If readiness were implemented
                // by parking the only completion carrier, this unrelated task
                // could not run.
                CountDownLatch unrelated = new CountDownLatch(1);
                completion.execute(unrelated::countDown);
                check(unrelated.await(2, TimeUnit.SECONDS),
                        "stalled read occupied the only completion carrier");
                check(ready.getCount() == 1, "silent peer became spuriously readable");

                peer.getOutputStream().write(0x5a);
                check(ready.await(2, TimeUnit.SECONDS), "readiness completion timed out");

                ByteBuffer one = ByteBuffer.allocate(1);
                int n = accepted.read(one);
                check(n == 1 && (one.array()[0] & 0xff) == 0x5a,
                        "readiness did not preserve the byte");
            }
        } finally {
            completion.shutdownNow();
            check(completion.awaitTermination(3, TimeUnit.SECONDS),
                    "completion carrier did not terminate");
        }
        System.out.println("SOURCE_FREE_NIO_SINGLE_CARRIER_PASS");
    }
}

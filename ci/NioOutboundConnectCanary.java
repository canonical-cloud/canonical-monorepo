import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;
import java.util.Iterator;

public final class NioOutboundConnectCanary {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static SocketChannel connectResolved(InetSocketAddress remote)
            throws Exception {
        check(!remote.isUnresolved(), "strict connect must reject unresolved addresses");
        SocketChannel channel = SocketChannel.open();
        boolean transferred = false;
        try (Selector selector = Selector.open()) {
            channel.configureBlocking(false);
            if (!channel.connect(remote)) {
                channel.register(selector, SelectionKey.OP_CONNECT);
                long deadline = System.nanoTime() + 3_000_000_000L;
                while (!channel.finishConnect()) {
                    long left = deadline - System.nanoTime();
                    check(left > 0, "OP_CONNECT timed out");
                    int ready = selector.select(Math.max(1L, left / 1_000_000L));
                    check(ready > 0, "selector did not report OP_CONNECT");
                    Iterator<SelectionKey> keys = selector.selectedKeys().iterator();
                    while (keys.hasNext()) {
                        SelectionKey key = keys.next();
                        keys.remove();
                        check(key.isConnectable(), "unexpected selector readiness");
                    }
                }
            }
            check(channel.isConnected(), "finishConnect did not establish connection");
            check(!channel.isBlocking(), "outbound channel became blocking");
            transferred = true;
            return channel;
        } finally {
            if (!transferred) channel.close();
        }
    }

    public static void main(String[] args) throws Exception {
        InetAddress loopback = InetAddress.getByAddress(new byte[] {127, 0, 0, 1});
        try (ServerSocketChannel listener = ServerSocketChannel.open()) {
            listener.bind(new InetSocketAddress(loopback, 0));
            int port = ((InetSocketAddress) listener.getLocalAddress()).getPort();

            try (SocketChannel client = connectResolved(
                         new InetSocketAddress(loopback, port));
                 SocketChannel accepted = listener.accept()) {
                ByteBuffer outbound = ByteBuffer.wrap(new byte[] {80, 73, 78, 71});
                while (outbound.hasRemaining()) {
                    int n = client.write(outbound);
                    check(n >= 0, "client write failed");
                    if (n == 0) Thread.onSpinWait();
                }

                ByteBuffer inbound = ByteBuffer.allocate(4);
                while (inbound.hasRemaining()) {
                    int n = accepted.read(inbound);
                    check(n >= 0, "server saw premature EOF");
                }
                check(java.util.Arrays.equals(
                        inbound.array(), new byte[] {80, 73, 78, 71}),
                        "connected channel corrupted payload");
            }
        }

        InetSocketAddress unresolved =
                InetSocketAddress.createUnresolved("must-not-resolve.example", 443);
        check(unresolved.isUnresolved(), "test address unexpectedly resolved");
        boolean rejected = false;
        try {
            connectResolved(unresolved);
        } catch (AssertionError expected) {
            rejected = expected.getMessage().contains("unresolved");
        }
        check(rejected, "unresolved host was not rejected before connect");

        System.out.println("SOURCE_FREE_NIO_OUTBOUND_CONNECT_PASS");
    }
}

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.ByteBuffer;
import java.nio.channels.SelectionKey;
import java.nio.channels.Selector;
import java.nio.channels.ServerSocketChannel;
import java.nio.channels.SocketChannel;

public final class NioDuplexSelectorCanary {
    private static void check(boolean value, String message) {
        if (!value) throw new AssertionError(message);
    }

    private static boolean duplexAdmissionAllowed(int existing, int requested) {
        if ((existing & requested) != 0) return false;
        int duplex = SelectionKey.OP_READ | SelectionKey.OP_WRITE;
        return (existing | requested) == duplex
                && (existing == SelectionKey.OP_READ || existing == SelectionKey.OP_WRITE)
                && (requested == SelectionKey.OP_READ || requested == SelectionKey.OP_WRITE);
    }

    public static void main(String[] args) throws Exception {
        check(duplexAdmissionAllowed(SelectionKey.OP_READ, SelectionKey.OP_WRITE),
                "read/write pair must be admissible");
        check(duplexAdmissionAllowed(SelectionKey.OP_WRITE, SelectionKey.OP_READ),
                "write/read pair must be admissible");
        check(!duplexAdmissionAllowed(SelectionKey.OP_READ, SelectionKey.OP_READ),
                "duplicate read must be rejected");
        check(!duplexAdmissionAllowed(SelectionKey.OP_WRITE, SelectionKey.OP_WRITE),
                "duplicate write must be rejected");
        check(!duplexAdmissionAllowed(SelectionKey.OP_CONNECT, SelectionKey.OP_READ),
                "connect/read multiplexing must stay closed");

        InetAddress loopback = InetAddress.getByAddress(new byte[] {127, 0, 0, 1});
        try (ServerSocketChannel listener = ServerSocketChannel.open();
             Selector selector = Selector.open()) {
            listener.bind(new InetSocketAddress(loopback, 0));
            int port = ((InetSocketAddress) listener.getLocalAddress()).getPort();

            try (SocketChannel client = SocketChannel.open()) {
                client.configureBlocking(false);
                check(!client.connect(new InetSocketAddress(loopback, port))
                                || client.finishConnect(),
                        "connect did not start/finish");
                while (!client.finishConnect()) Thread.onSpinWait();

                try (SocketChannel peer = listener.accept()) {
                    peer.configureBlocking(true);
                    SelectionKey key = client.register(
                            selector, SelectionKey.OP_READ | SelectionKey.OP_WRITE);

                    int n = selector.select(3000);
                    check(n == 1, "combined read/write key did not become writable");
                    var selected = selector.selectedKeys().iterator();
                    SelectionKey ready = selected.next();
                    selected.remove();
                    int first = ready.readyOps();
                    check((first & SelectionKey.OP_WRITE) != 0,
                            "combined key missing OP_WRITE");
                    check((first & SelectionKey.OP_READ) == 0,
                            "silent peer unexpectedly produced OP_READ");

                    // Retire only the writable sub-watch. The read interest must
                    // remain armed on the same physical key.
                    key.interestOps(SelectionKey.OP_READ);
                    check(selector.selectNow() == 0,
                            "retired OP_WRITE produced stale readiness");

                    peer.write(ByteBuffer.wrap(new byte[] {(byte) 0x5a}));
                    n = selector.select(3000);
                    check(n == 1, "remaining OP_READ did not wake");
                    selected = selector.selectedKeys().iterator();
                    ready = selected.next();
                    selected.remove();
                    check((ready.readyOps() & SelectionKey.OP_READ) != 0,
                            "missing OP_READ after peer data");

                    ByteBuffer one = ByteBuffer.allocate(1);
                    check(client.read(one) == 1, "client did not consume peer byte");
                    check(one.array()[0] == (byte) 0x5a, "peer byte changed");

                    // Retire read and re-arm the same key for write. This
                    // models cancellation/completion of one direction followed
                    // by fresh same-FD ownership.
                    key.interestOps(SelectionKey.OP_WRITE);
                    n = selector.select(3000);
                    check(n == 1, "same key did not re-arm OP_WRITE");
                    selected = selector.selectedKeys().iterator();
                    ready = selected.next();
                    selected.remove();
                    check((ready.readyOps() & SelectionKey.OP_WRITE) != 0,
                            "re-armed key missing OP_WRITE");
                    key.cancel();
                }
            }
        }

        System.out.println("SOURCE_FREE_NIO_DUPLEX_SELECTOR_PASS");
    }
}

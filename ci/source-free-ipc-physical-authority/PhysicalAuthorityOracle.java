import java.util.Arrays;

/**
 * Independent source-free model of broker-minted one-shot physical
 * connection authority. Contains no private Oreslang implementation source.
 */
public final class PhysicalAuthorityOracle {
    private PhysicalAuthorityOracle() { }

    private static final class Transfer {
        final long generation;
        final Object owner;
        final byte[] key;
        final byte[] binding;

        Transfer(long generation, Object owner, byte[] key, byte[] binding) {
            this.generation = generation;
            this.owner = owner;
            this.key = key;
            this.binding = binding;
        }

        void destroy() {
            Arrays.fill(key, (byte) 0);
            Arrays.fill(binding, (byte) 0);
        }
    }

    private static final class Authority {
        private final long generation;
        private Object owner;
        private byte[] key;
        private byte[] binding;
        private boolean terminal;

        Authority(long generation, byte[] key, byte[] binding) {
            this.generation = generation;
            this.owner = new Object();
            this.key = key;
            this.binding = binding;
        }

        synchronized Transfer consume() {
            if (terminal) throw new IllegalStateException("already consumed");
            Transfer transfer = new Transfer(generation, owner, key, binding);
            terminal = true;
            owner = null;
            key = null;
            binding = null;
            return transfer;
        }

        synchronized boolean terminal() { return terminal; }
    }

    private static final class Broker {
        private long lastGeneration;
        private int bindingSequence;

        synchronized Authority mint(long generation, byte[] negotiatedKey) {
            if (generation <= lastGeneration) {
                throw new IllegalArgumentException("generation rollback");
            }
            byte[] privateKey = negotiatedKey.clone();
            byte[] binding = new byte[16];
            int seed = ++bindingSequence;
            for (int i = 0; i < binding.length; ++i) {
                binding[i] = (byte) (seed + i + 1);
            }
            Authority authority = new Authority(
                    generation, privateKey, binding);
            lastGeneration = generation;
            return authority;
        }
    }

    private static boolean allZero(byte[] values) {
        for (byte value : values) if (value != 0) return false;
        return true;
    }

    private static Transfer construct(
            Authority authority,
            boolean failBeforeConsume,
            boolean failAfterConsume) {
        if (failBeforeConsume) return null;
        Transfer transfer = authority.consume();
        if (failAfterConsume) {
            transfer.destroy();
            return null;
        }
        return transfer;
    }

    private static void oneRound(int round) {
        Broker broker = new Broker();
        byte[] callerKey = new byte[32];
        for (int i = 0; i < callerKey.length; ++i) {
            callerKey[i] = (byte) (round + i + 1);
        }
        byte[] expectedKey = callerKey.clone();

        Authority retryable = broker.mint(10, callerKey);
        Arrays.fill(callerKey, (byte) 0);

        if (construct(retryable, true, false) != null || retryable.terminal()) {
            throw new AssertionError("pre-consume failure burned authority");
        }

        Transfer first = construct(retryable, false, false);
        if (first == null || !retryable.terminal()) {
            throw new AssertionError("successful transfer did not consume authority");
        }
        if (!Arrays.equals(first.key, expectedKey)) {
            throw new AssertionError("caller key mutation reached private authority");
        }
        if (allZero(first.binding)) {
            throw new AssertionError("binding was not fresh/nonzero");
        }

        try {
            retryable.consume();
            throw new AssertionError("authority reused");
        } catch (IllegalStateException expected) {
            // one-shot
        }

        try {
            broker.mint(10, expectedKey);
            throw new AssertionError("generation replay accepted");
        } catch (IllegalArgumentException expected) {
            // monotonic
        }
        try {
            broker.mint(9, expectedKey);
            throw new AssertionError("generation rollback accepted");
        } catch (IllegalArgumentException expected) {
            // monotonic
        }

        Authority next = broker.mint(11, expectedKey);
        Transfer second = next.consume();
        if (second.owner == first.owner
                || Arrays.equals(second.binding, first.binding)) {
            throw new AssertionError("reconnect reused owner/binding");
        }

        Authority burned = broker.mint(12, expectedKey);
        if (construct(burned, false, true) != null || !burned.terminal()) {
            throw new AssertionError("post-consume failure did not burn authority");
        }
        try {
            burned.consume();
            throw new AssertionError("burned authority resurrected");
        } catch (IllegalStateException expected) {
            // permanently spent
        }

        first.destroy();
        second.destroy();
        if (!allZero(first.key) || !allZero(first.binding)
                || !allZero(second.key) || !allZero(second.binding)) {
            throw new AssertionError("transferred credentials not destroyed");
        }
    }

    public static void main(String[] args) {
        for (int i = 0; i < 100_000; ++i) oneRound(i);
        System.out.println("SOURCE_FREE_PHYSICAL_AUTHORITY_PASS rounds=100000");
    }
}

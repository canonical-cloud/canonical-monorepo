import java.util.Arrays;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Independent source-free model of broker-minted one-shot physical
 * connection authority. Contains no private Oreslang implementation source.
 */
public final class PhysicalAuthorityOracle {
    private PhysicalAuthorityOracle() { }

    private static final ThreadLocal<Boolean> ACTOR =
            ThreadLocal.withInitial(() -> Boolean.FALSE);

    private static void requireHost() {
        if (ACTOR.get()) {
            throw new IllegalStateException("actor carrier cannot enter host authority operation");
        }
    }

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

        Transfer consume() {
            requireHost();
            synchronized (this) {
                if (terminal) throw new IllegalStateException("already consumed");
                Transfer transfer = new Transfer(generation, owner, key, binding);
                terminal = true;
                owner = null;
                key = null;
                binding = null;
                return transfer;
            }
        }

        boolean terminal() {
            requireHost();
            synchronized (this) {
                return terminal;
            }
        }

        void destroyUnused() {
            requireHost();
            synchronized (this) {
                if (terminal) return;
                terminal = true;
                Arrays.fill(key, (byte) 0);
                Arrays.fill(binding, (byte) 0);
                owner = null;
                key = null;
                binding = null;
            }
        }
    }

    private static final class Broker {
        private long lastGeneration;
        private int bindingSequence;

        Authority mint(long generation, byte[] negotiatedKey) {
            requireHost();
            synchronized (this) {
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
    }

    private static boolean allZero(byte[] values) {
        for (byte value : values) if (value != 0) return false;
        return true;
    }

    private static Transfer construct(
            Authority authority,
            boolean failBeforeConsume,
            boolean failAfterConsume) {
        requireHost();
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

    private static void proveGuardBeforeMonitor() throws Exception {
        Broker broker = new Broker();
        byte[] key = new byte[32];
        Arrays.fill(key, (byte) 9);

        CountDownLatch brokerHeld = new CountDownLatch(1);
        CountDownLatch releaseBroker = new CountDownLatch(1);
        Thread holder = new Thread(() -> {
            synchronized (broker) {
                brokerHeld.countDown();
                try {
                    if (!releaseBroker.await(3, TimeUnit.SECONDS)) {
                        throw new AssertionError("broker hold timed out");
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError(interrupted);
                }
            }
        }, "oracle-broker-holder");
        holder.start();
        if (!brokerHeld.await(3, TimeUnit.SECONDS)) {
            throw new AssertionError("broker monitor not held");
        }

        AtomicReference<Throwable> actorFailure = new AtomicReference<>();
        AtomicInteger denials = new AtomicInteger();
        Thread actor = new Thread(() -> {
            ACTOR.set(Boolean.TRUE);
            try {
                try {
                    broker.mint(1, key);
                    throw new AssertionError("actor entered broker monitor");
                } catch (IllegalStateException expected) {
                    denials.incrementAndGet();
                }
            } catch (Throwable failure) {
                actorFailure.set(failure);
            } finally {
                ACTOR.remove();
            }
        }, "oracle-broker-actor");
        actor.start();
        actor.join(500);
        if (actor.isAlive() || actorFailure.get() != null || denials.get() != 1) {
            throw new AssertionError("actor did not fail before broker monitor", actorFailure.get());
        }
        releaseBroker.countDown();
        holder.join(3000);

        Authority authority = broker.mint(1, key);
        CountDownLatch authorityHeld = new CountDownLatch(1);
        CountDownLatch releaseAuthority = new CountDownLatch(1);
        Thread authorityHolder = new Thread(() -> {
            synchronized (authority) {
                authorityHeld.countDown();
                try {
                    if (!releaseAuthority.await(3, TimeUnit.SECONDS)) {
                        throw new AssertionError("authority hold timed out");
                    }
                } catch (InterruptedException interrupted) {
                    Thread.currentThread().interrupt();
                    throw new AssertionError(interrupted);
                }
            }
        }, "oracle-authority-holder");
        authorityHolder.start();
        if (!authorityHeld.await(3, TimeUnit.SECONDS)) {
            throw new AssertionError("authority monitor not held");
        }

        AtomicReference<Throwable> authorityFailure = new AtomicReference<>();
        AtomicInteger authorityDenials = new AtomicInteger();
        Thread authorityActor = new Thread(() -> {
            ACTOR.set(Boolean.TRUE);
            try {
                try {
                    authority.consume();
                    throw new AssertionError("actor entered consume monitor");
                } catch (IllegalStateException expected) {
                    authorityDenials.incrementAndGet();
                }
                try {
                    authority.terminal();
                    throw new AssertionError("actor entered diagnostic monitor");
                } catch (IllegalStateException expected) {
                    authorityDenials.incrementAndGet();
                }
                try {
                    authority.destroyUnused();
                    throw new AssertionError("actor entered destroy monitor");
                } catch (IllegalStateException expected) {
                    authorityDenials.incrementAndGet();
                }
                try {
                    construct(authority, false, false);
                    throw new AssertionError("actor entered construction transfer");
                } catch (IllegalStateException expected) {
                    authorityDenials.incrementAndGet();
                }
            } catch (Throwable failure) {
                authorityFailure.set(failure);
            } finally {
                ACTOR.remove();
            }
        }, "oracle-authority-actor");
        authorityActor.start();
        authorityActor.join(500);
        if (authorityActor.isAlive()
                || authorityFailure.get() != null
                || authorityDenials.get() != 4) {
            throw new AssertionError(
                    "actor did not fail before authority monitor/transfer",
                    authorityFailure.get());
        }

        releaseAuthority.countDown();
        authorityHolder.join(3000);
        if (authority.terminal()) {
            throw new AssertionError("actor denial consumed authority");
        }
        authority.destroyUnused();
        if (!authority.terminal()) {
            throw new AssertionError("host destroy did not terminate authority");
        }
    }

    public static void main(String[] args) throws Exception {
        for (int i = 0; i < 100_000; ++i) oneRound(i);
        proveGuardBeforeMonitor();
        System.out.println(
                "SOURCE_FREE_PHYSICAL_AUTHORITY_PASS rounds=100000 guardBeforeMonitor=true");
    }
}

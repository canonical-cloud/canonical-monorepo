import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Independent source-free model for IPC receipt admission fencing and sticky
 * physical-close failure precedence. Contains no private Oreslang source.
 */
public final class CloseFencePrecedenceOracle {
    private CloseFencePrecedenceOracle() { }

    private static final class ReceiptFence {
        private final Object readGate = new Object();
        private volatile boolean closed;
        private int bytesConsumed;
        private int ledgerTransitions;

        int readOne(
                CountDownLatch admitted,
                CountDownLatch releaseAdmitted) throws Exception {
            if (closed) throw new IOException("receipt read after close request");
            synchronized (readGate) {
                // This inner check is the admission linearization point.
                if (closed) {
                    throw new IOException("receipt read after close request");
                }
                admitted.countDown();
                if (releaseAdmitted != null
                        && !releaseAdmitted.await(2, TimeUnit.SECONDS)) {
                    throw new AssertionError("admitted reader release timed out");
                }
                bytesConsumed++;
                ledgerTransitions++;
                return ledgerTransitions;
            }
        }

        void closeIntent() {
            closed = true;
        }

        synchronized int bytesConsumed() { return bytesConsumed; }
        synchronized int ledgerTransitions() { return ledgerTransitions; }
    }

    private static void receiptFenceRound() throws Exception {
        ReceiptFence fence = new ReceiptFence();
        CountDownLatch firstAdmitted = new CountDownLatch(1);
        CountDownLatch releaseFirst = new CountDownLatch(1);
        CountDownLatch secondStarted = new CountDownLatch(1);
        AtomicReference<Throwable> firstFailure = new AtomicReference<>();
        AtomicReference<Throwable> secondFailure = new AtomicReference<>();
        AtomicInteger firstResult = new AtomicInteger();
        AtomicInteger secondResult = new AtomicInteger();

        Thread first = new Thread(() -> {
            try {
                firstResult.set(fence.readOne(firstAdmitted, releaseFirst));
            } catch (Throwable failure) {
                firstFailure.set(failure);
            }
        }, "oracle-preclose-admitted-reader");
        first.start();
        if (!firstAdmitted.await(2, TimeUnit.SECONDS)) {
            throw new AssertionError("first reader was not admitted");
        }

        Thread second = new Thread(() -> {
            secondStarted.countDown();
            try {
                secondResult.set(fence.readOne(new CountDownLatch(0), null));
            } catch (Throwable failure) {
                secondFailure.set(failure);
            }
        }, "oracle-queued-reader");
        second.start();
        if (!secondStarted.await(2, TimeUnit.SECONDS)) {
            throw new AssertionError("second reader did not start");
        }

        // Reader A is already admitted under readGate. Reader B has only
        // passed the optional outer precheck and is queued behind A.
        fence.closeIntent();
        if (fence.bytesConsumed() != 0 || fence.ledgerTransitions() != 0) {
            throw new AssertionError("close intent consumed receipt state");
        }

        releaseFirst.countDown();
        first.join(2000);
        second.join(2000);
        if (first.isAlive() || second.isAlive()) {
            throw new AssertionError("receipt fence readers did not finish");
        }
        if (firstFailure.get() != null) {
            throw new AssertionError("preclose admitted reader was rejected", firstFailure.get());
        }
        if (firstResult.get() != 1) {
            throw new AssertionError("admitted reader did not apply exactly one receipt");
        }
        if (!(secondFailure.get() instanceof IOException)) {
            throw new AssertionError("queued reader crossed close fence", secondFailure.get());
        }
        if (secondResult.get() != 0) {
            throw new AssertionError("queued reader produced a stage");
        }
        if (fence.bytesConsumed() != 1 || fence.ledgerTransitions() != 1) {
            throw new AssertionError("queued reader consumed bytes or ledger state");
        }

        // A reader that starts after close must fail at the outer fence and
        // consume zero additional wire/ledger state.
        int bytesBefore = fence.bytesConsumed();
        int ledgerBefore = fence.ledgerTransitions();
        try {
            fence.readOne(new CountDownLatch(0), null);
            throw new AssertionError("post-close reader succeeded");
        } catch (IOException expected) {
            // fenced
        }
        if (fence.bytesConsumed() != bytesBefore
                || fence.ledgerTransitions() != ledgerBefore) {
            throw new AssertionError("post-close reader consumed state");
        }
    }

    private static final class FailurePrecedence {
        enum Phase { CLOSING, FINALIZING, QUARANTINED, RETIRED }

        private Phase phase = Phase.CLOSING;
        private boolean physicalCloseAttempted;
        private boolean physicalCloseExecuting;
        private boolean physicalCloseConfirmed;
        private boolean physicalCloseFailureRecorded;
        private Throwable failure;

        synchronized void lifecycleFailure(Throwable next) {
            if (!physicalCloseFailureRecorded) {
                failure = next;
            }
            phase = Phase.QUARANTINED;
        }

        synchronized void beginPhysicalClose() {
            if (physicalCloseAttempted || physicalCloseExecuting
                    || physicalCloseConfirmed) {
                throw new IllegalStateException("physical close already owned");
            }
            physicalCloseAttempted = true;
            physicalCloseExecuting = true;
        }

        synchronized void physicalCloseFailed(Throwable next) {
            if (!physicalCloseAttempted || !physicalCloseExecuting
                    || physicalCloseConfirmed) {
                throw new IllegalStateException("no executing physical close");
            }
            physicalCloseExecuting = false;
            physicalCloseFailureRecorded = true;
            failure = next;
            phase = Phase.QUARANTINED;
        }

        synchronized void deferredSchedulerNoise(Throwable next) {
            if (!physicalCloseFailureRecorded && failure == null) {
                failure = next;
            }
        }

        synchronized void assertSticky(Throwable physical) {
            if (phase != Phase.QUARANTINED
                    || !physicalCloseAttempted
                    || physicalCloseExecuting
                    || physicalCloseConfirmed
                    || !physicalCloseFailureRecorded
                    || failure != physical) {
                throw new AssertionError("physical close failure lost precedence");
            }
        }
    }

    private static void failurePrecedenceRound() {
        FailurePrecedence state = new FailurePrecedence();
        Throwable earlyScheduler =
                new IllegalStateException("early scheduling failure");
        Throwable physical =
                new IOException("physical descriptor close failure");
        Throwable laterTimeout =
                new IOException("later supervisor timeout");
        Throwable laterScheduler =
                new IllegalStateException("later scheduler noise");

        state.lifecycleFailure(earlyScheduler);
        state.beginPhysicalClose();
        state.physicalCloseFailed(physical);
        state.assertSticky(physical);

        state.lifecycleFailure(laterTimeout);
        state.deferredSchedulerNoise(laterScheduler);
        state.assertSticky(physical);
    }

    public static void main(String[] args) throws Exception {
        for (int i = 0; i < 20_000; ++i) {
            receiptFenceRound();
            failurePrecedenceRound();
        }
        System.out.println(
                "SOURCE_FREE_CLOSE_FENCE_PRECEDENCE_PASS rounds=20000");
    }
}

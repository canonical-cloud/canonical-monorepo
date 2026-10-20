import java.io.IOException;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

/**
 * Independent source-free model for one physical descriptor close shared by
 * active-write abort and finalization. Contains no private Oreslang source.
 */
public final class PhysicalCloseOwnershipOracle {
    private PhysicalCloseOwnershipOracle() { }

    enum Phase { CLOSING, FINALIZING, QUARANTINED, RETIRED }

    private static final class Model {
        private Phase phase = Phase.CLOSING;
        private int activeWrites = 1;
        private boolean closeAttempted;
        private boolean closeExecuting;
        private boolean closeConfirmed;
        private boolean receiptsRetired;
        private int closeInvocations;

        synchronized boolean beginExternalClose() {
            if ((phase != Phase.CLOSING && phase != Phase.QUARANTINED)
                    || activeWrites <= 0
                    || closeAttempted || closeExecuting || closeConfirmed) {
                return false;
            }
            closeAttempted = true;
            closeExecuting = true;
            return true;
        }

        synchronized void recordCloseInvocation() {
            if (!closeExecuting || !closeAttempted || closeConfirmed) {
                throw new AssertionError("descriptor close invoked without ownership");
            }
            closeInvocations++;
            if (closeInvocations != 1) {
                throw new AssertionError("descriptor close invoked more than once");
            }
        }

        synchronized void writerDrained() {
            if (activeWrites != 1) {
                throw new AssertionError("invalid active write count");
            }
            activeWrites = 0;
            if (phase == Phase.CLOSING && !closeExecuting) {
                phase = Phase.FINALIZING;
            }
        }

        synchronized void completeExternalClose(Throwable failure) {
            if (!closeAttempted || !closeExecuting || closeConfirmed) {
                throw new AssertionError("external close completion without claim");
            }
            closeExecuting = false;
            if (failure != null) {
                phase = Phase.QUARANTINED;
                return;
            }
            closeConfirmed = true;
            if (phase == Phase.CLOSING && activeWrites == 0) {
                phase = Phase.FINALIZING;
            }
        }

        synchronized boolean externalRetryable() {
            return phase == Phase.QUARANTINED
                    && activeWrites > 0
                    && !closeAttempted
                    && !closeExecuting
                    && !closeConfirmed;
        }

        synchronized void quarantineBeforeClose() {
            if (closeAttempted) throw new AssertionError("close already attempted");
            phase = Phase.QUARANTINED;
        }

        synchronized void retryFinalization() {
            if (phase != Phase.QUARANTINED || activeWrites != 0) {
                throw new IllegalStateException("not retryable");
            }
            if (closeAttempted && !closeConfirmed) {
                throw new IllegalStateException("unconfirmed close");
            }
            phase = Phase.FINALIZING;
        }

        synchronized void finalizeAndRetire(boolean closerThrows) throws IOException {
            if (phase != Phase.FINALIZING || activeWrites != 0) {
                throw new IllegalStateException("not finalizing");
            }
            if (!closeConfirmed) {
                if (closeExecuting || closeAttempted) {
                    phase = Phase.QUARANTINED;
                    throw new IllegalStateException("close already owned or unconfirmed");
                }
                closeAttempted = true;
                closeExecuting = true;
                closeInvocations++;
                if (closeInvocations != 1) {
                    throw new AssertionError("finalizer invoked close twice");
                }
                if (closerThrows) {
                    closeExecuting = false;
                    phase = Phase.QUARANTINED;
                    throw new IOException("close outcome unconfirmed");
                }
                closeExecuting = false;
                closeConfirmed = true;
            }
            receiptsRetired = true;
            phase = Phase.RETIRED;
        }

        synchronized void assertRetiredExactlyOnce() {
            if (phase != Phase.RETIRED || activeWrites != 0
                    || !closeAttempted || closeExecuting || !closeConfirmed
                    || !receiptsRetired || closeInvocations != 1) {
                throw new AssertionError("retired invariant failed");
            }
        }

        synchronized void assertAmbiguousQuarantineExactlyOnce() {
            if (phase != Phase.QUARANTINED || closeInvocations != 1
                    || !closeAttempted || closeExecuting || closeConfirmed
                    || receiptsRetired) {
                throw new AssertionError("ambiguous close quarantine invariant failed");
            }
        }

        synchronized int closeInvocations() { return closeInvocations; }
        synchronized int activeWrites() { return activeWrites; }
        synchronized boolean closeExecuting() { return closeExecuting; }
        synchronized Phase phase() { return phase; }
    }

    private static void abortWinsRace() throws Exception {
        Model model = new Model();
        CountDownLatch closeEntered = new CountDownLatch(1);
        CountDownLatch writerDrained = new CountDownLatch(1);
        CountDownLatch releaseClose = new CountDownLatch(1);
        AtomicReference<Throwable> failure = new AtomicReference<>();

        Thread abort = new Thread(() -> {
            try {
                if (!model.beginExternalClose()) {
                    throw new AssertionError("abort did not claim close");
                }
                model.recordCloseInvocation();
                closeEntered.countDown();

                // Descriptor close wakes the pinned writer before the close
                // invocation itself returns.
                model.writerDrained();
                writerDrained.countDown();

                if (!releaseClose.await(2, TimeUnit.SECONDS)) {
                    throw new AssertionError("close release timed out");
                }
                model.completeExternalClose(null);
            } catch (Throwable problem) {
                failure.compareAndSet(null, problem);
            }
        }, "oracle-abort-owner");

        abort.start();
        if (!closeEntered.await(2, TimeUnit.SECONDS)
                || !writerDrained.await(2, TimeUnit.SECONDS)) {
            throw new AssertionError("abort interleaving did not occur");
        }

        if (model.activeWrites() != 0 || !model.closeExecuting()) {
            throw new AssertionError("writer did not drain while close in flight");
        }
        // Writer drain must not start finalization while abort owns close.
        if (model.phase() != Phase.CLOSING || model.closeInvocations() != 1) {
            throw new AssertionError("finalizer stole in-flight close");
        }

        releaseClose.countDown();
        abort.join(2000);
        if (abort.isAlive() || failure.get() != null) {
            throw new AssertionError("abort owner failed", failure.get());
        }

        if (model.phase() != Phase.FINALIZING) {
            throw new AssertionError("confirmed abort did not hand off finalization");
        }
        model.finalizeAndRetire(false);
        model.assertRetiredExactlyOnce();
    }

    private static void ambiguousAbortFailureIsNeverRetried() throws Exception {
        Model model = new Model();
        if (!model.beginExternalClose()) {
            throw new AssertionError("abort did not claim close");
        }
        model.recordCloseInvocation();
        model.writerDrained();
        model.completeExternalClose(new IOException("unconfirmed close"));
        model.assertAmbiguousQuarantineExactlyOnce();

        if (model.externalRetryable()) {
            throw new AssertionError("ambiguous close became abort-retryable");
        }
        try {
            model.retryFinalization();
            throw new AssertionError("ambiguous close became finalization-retryable");
        } catch (IllegalStateException expected) {
            // fail closed
        }
        if (model.closeInvocations() != 1) {
            throw new AssertionError("ambiguous close was invoked again");
        }
    }

    private static void preCloseFailureRemainsRetryable() throws Exception {
        Model model = new Model();
        model.quarantineBeforeClose();
        if (!model.externalRetryable()) {
            throw new AssertionError("pre-close scheduler failure not retryable");
        }
        if (!model.beginExternalClose()) {
            throw new AssertionError("retry did not claim close");
        }
        model.recordCloseInvocation();
        model.writerDrained();
        model.completeExternalClose(null);
        model.retryFinalization();
        model.finalizeAndRetire(false);
        model.assertRetiredExactlyOnce();
    }

    private static void finalizerFailureIsNeverRetried() throws Exception {
        Model model = new Model();
        model.writerDrained();
        if (model.phase() != Phase.FINALIZING) {
            throw new AssertionError("normal close did not enter finalization");
        }
        try {
            model.finalizeAndRetire(true);
            throw new AssertionError("throwing closer reported success");
        } catch (IOException expected) {
            // ambiguous after exactly one invocation
        }
        model.assertAmbiguousQuarantineExactlyOnce();
        try {
            model.retryFinalization();
            throw new AssertionError("throwing finalizer close was retried");
        } catch (IllegalStateException expected) {
            // fail closed
        }
        if (model.closeInvocations() != 1) {
            throw new AssertionError("throwing finalizer close invoked twice");
        }
    }

    public static void main(String[] args) throws Exception {
        for (int i = 0; i < 20_000; ++i) {
            abortWinsRace();
            ambiguousAbortFailureIsNeverRetried();
            preCloseFailureRemainsRetryable();
            finalizerFailureIsNeverRetried();
        }
        System.out.println(
                "SOURCE_FREE_PHYSICAL_CLOSE_OWNERSHIP_PASS rounds=20000 scenarios=4");
    }
}

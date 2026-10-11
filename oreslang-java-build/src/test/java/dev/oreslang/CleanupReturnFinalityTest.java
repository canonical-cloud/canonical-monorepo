package dev.oreslang;

import dev.oreslang.parser.Parser;
import dev.oreslang.types.TypeChecker;
import org.graalvm.polyglot.Context;
import org.graalvm.polyglot.Source;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

final class CleanupReturnFinalityTest {
    private static final String BOX = """
            define class Box as
              pub let int value = 1;
            end
            """;

    private static void admitted(String source) {
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(BOX + source)));
    }

    private static void rejected(String source, String message) {
        IllegalArgumentException error = assertThrows(IllegalArgumentException.class,
                () -> TypeChecker.check(Parser.parse(BOX + source)));
        assertTrue(error.getMessage().contains(message), error::getMessage);
    }

    @Test
    void finallyCannotOverrideAnEvaluatedReturn() {
        rejected("""
                fnc value(): int {
                  try { return 1; }
                  catch (err) { return 2; }
                  finally { return 3; }
                }
                """, "return is not allowed inside finally");
    }

    @Test
    void nestedReturnInsideFinallyIsRejected() {
        rejected("""
                fnc value(): int {
                  try { return 1; }
                  catch (err) { return 2; }
                  finally {
                    if (true) { return 3; } fi
                  }
                }
                """, "return is not allowed inside finally");
    }

    @Test
    void finallyCannotBreakOutOfAnEnclosingLoop() {
        rejected("""
                fnc value(): int {
                  loop {
                    try { return 1; }
                    catch (err) { return 2; }
                    finally { break; }
                  }
                  return 3;
                }
                """, "break cannot escape finally");
    }

    @Test
    void finallyCannotContinueAnEnclosingLoop() {
        rejected("""
                fnc value(): int {
                  loop {
                    try { return 1; }
                    catch (err) { return 2; }
                    finally { continue; }
                  }
                  return 3;
                }
                """, "continue cannot escape finally");
    }

    @Test
    void finallyMayBreakItsOwnCleanupLoop() {
        admitted("""
                fnc value(): int {
                  try { return 1; }
                  catch (err) { return 2; }
                  finally { loop { break; } }
                }
                """);
    }

    @Test
    void deferredRebindingOfTheReturnedLocalIsRejected() {
        rejected("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  defer result = new Box();
                  return result;
                }
                """, "defer cannot reassign returned binding 'result'");
    }

    @Test
    void deferredLambdaCannotRebindReturnedLocalEither() {
        rejected("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  defer || -> { result = new Box(); };
                  return result;
                }
                """, "defer cannot reassign returned binding 'result'");
    }

    @Test
    void shadowedLocalIsNotTheReturnedBinding() {
        admitted("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  if (true) {
                    let mut int result = 0;
                    defer result = 1;
                  } fi
                  return result;
                }
                """);
    }

    @Test
    void deferMayReassignUnrelatedLocal() {
        admitted("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  let mut int cleanupCount = 0;
                  defer cleanupCount = 1;
                  return result;
                }
                """);
    }

    @Test
    void namedDeferredCallbackCannotRebindTheReturnedLocal() {
        rejected("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  const cleanup = || -> { result = new Box(); };
                  defer cleanup();
                  return result;
                }
                """, "defer cannot reassign returned binding 'result'");
    }

    @Test
    void namedDeferredCallbackMayRebindOnlyItsShadowedLocal() {
        admitted("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  const cleanup = || -> {
                    let mut Box result = new Box();
                    result = new Box();
                  };
                  defer cleanup();
                  return result;
                }
                """);
    }

    @Test
    void aliasedDeferredCallbackCannotRebindReturnedBinding() {
        rejected("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  const cleanup = || -> { result = new Box(); };
                  const alias = cleanup;
                  defer alias();
                  return result;
                }
                """, "defer cannot reassign returned binding 'result'");
    }

    @Test
    void finallyCanCleanUpSeparateBorrowWithoutReplacingReturn() throws Exception {
        String source = BOX + """
                fnc make(borrow mut Box audit): int {
                  try { return 9; }
                  catch (err) { return 4; }
                  finally { audit.value = 7; }
                }
                pub fnc main(): int {
                  let mut Box audit = new Box();
                  val int returned = make(rt borrow mut audit);
                  return returned + audit.value;
                }
                """;
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(source)));
        try (Context context = Context.newBuilder("ores").allowAllAccess(false).build()) {
            assertEquals(16L, context.eval(
                    Source.newBuilder("ores", source, "finally-cleanup-loan.ores").build()).asLong());
        }
    }

    @Test
    void failedDeferredCleanupDoesNotSkipRemainingDefers() throws Exception {
        String source = """
                fnc fail(): void {
                  val Array<int> empty = new Array<int>();
                  empty.get(0);
                  return;
                }
                fnc perform(borrow mut Array<int> output): void {
                  defer output.add(1);
                  defer fail();
                  defer output.add(2);
                  return;
                }
                pub fnc main(): int {
                  let mut Array<int> output = new Array<int>();
                  try {
                    perform(rt borrow mut output);
                  } catch (err) {
                  } finally {
                  }
                  return output.get(0) * 10 + output.get(1);
                }
                """;
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(source)));
        try (Context context = Context.newBuilder("ores").allowAllAccess(false).build()) {
            assertEquals(21L, context.eval(
                    Source.newBuilder("ores", source, "failed-deferred-cleanup.ores").build()).asLong());
        }
    }

    @Test
    void nestedCallSiteShadowCannotHideRebindingOfPendingReturn() {
        rejected("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  const cleanup = || -> { result = new Box(); };
                  const alias = cleanup;
                  try { return result; }
                  catch (err) { return result; }
                  finally {
                    let mut Box result = new Box();
                    defer alias();
                  }
                }
                """, "defer cannot reassign returned binding 'result'");
    }

    @Test
    void namedCallbackKeepsItsOwnShadowedBindingInFinally() {
        admitted("""
                fnc make(): Box {
                  let mut Box result = new Box();
                  const cleanup = || -> {
                    let mut Box result = new Box();
                    result = new Box();
                  };
                  try { return result; }
                  catch (err) { return result; }
                  finally {
                    let mut Box result = new Box();
                    defer cleanup();
                  }
                }
                """);
    }

    @Test
    void deferredArrayMutationPreservesTheOriginalReturnedObject() throws Exception {
        String code = """
                fnc make(): Array<int> {
                  let mut Array<int> result = new Array<int>();
                  result.add(1);
                  defer result.add(4);
                  return result;
                }
                pub fnc main(): int {
                  val Array<int> result = make();
                  return result.get(1);
                }
                """;
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(code)));
        try (Context context = Context.newBuilder("ores").allowAllAccess(false).build()) {
            assertEquals(4L, context.eval(Source.newBuilder("ores", code, "deferred-array.ores").build()).asLong());
        }
    }

    @Test
    void deferredArrayMutationsExecuteInLifoOrder() throws Exception {
        String code = """
                fnc make(): Array<int> {
                  let mut Array<int> result = new Array<int>();
                  defer result.add(1);
                  defer result.add(2);
                  return result;
                }
                pub fnc main(): int {
                  val Array<int> result = make();
                  return result.get(0) * 10 + result.get(1);
                }
                """;
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(code)));
        try (Context context = Context.newBuilder("ores").allowAllAccess(false).build()) {
            assertEquals(21L, context.eval(Source.newBuilder("ores", code, "deferred-array-lifo.ores").build()).asLong());
        }
    }

    @Test
    void deferredLambdaIsInvokedAndMayMutateReturnedReferent() throws Exception {
        String code = BOX + """
                fnc make(): Box {
                  val Box result = new Box();
                  defer || -> { result.value = 8; };
                  return result;
                }
                pub fnc main(): int {
                  val Box result = make();
                  return result.value;
                }
                """;
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(code)));
        try (Context context = Context.newBuilder("ores").allowAllAccess(false).build()) {
            assertEquals(8L, context.eval(Source.newBuilder("ores", code, "deferred-lambda.ores").build()).asLong());
        }
    }

    @Test
    void deferCannotRegisterLambdaRequiringArguments() {
        rejected("""
                fnc invalid(): Box {
                  let mut Box result = new Box();
                  defer |int value| -> { result.value = value; };
                  return result;
                }
                """, "defer cleanup lambda must accept zero parameters");
    }

    @Test
    void lambdaReturnInsideFinallyDoesNotOverrideOuterReturn() {
        admitted("""
                fnc value(): int {
                  try { return 1; }
                  catch (err) { return 2; }
                  finally {
                    const cleanup = || -> { return 7; };
                  }
                }
                """);
    }

    @Test
    void mutableReturnedObjectIsModifiedByDefer() throws Exception {
        String code = BOX + """
                fnc bump(borrow mut Box box): void {
                  box.value = box.value + 1;
                  return;
                }
                fnc make(): Box {
                  val Box result = new Box();
                  defer bump(rt borrow mut result);
                  return result;
                }
                pub fnc main(): int {
                  val Box result = make();
                  return result.value;
                }
                """;
        assertDoesNotThrow(() -> TypeChecker.check(Parser.parse(code)));
        try (Context context = Context.newBuilder("ores").allowAllAccess(true).build()) {
            assertEquals(2L, context.eval(Source.newBuilder("ores", code, "cleanup-return.ores").build()).asLong());
        }
    }
}

cmake_minimum_required(VERSION 3.20)
project(oreslang_llvm VERSION 0.2.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(LLVM CONFIG REQUIRED)
if(LLVM_VERSION_MAJOR LESS 14)
    message(FATAL_ERROR "Oreslang requires LLVM 14 or newer; found ${LLVM_PACKAGE_VERSION}")
endif()
message(STATUS "Building Oreslang LLVM against LLVM ${LLVM_PACKAGE_VERSION}")

add_executable(oreslang-llvmc
    src/main/cpp/oreslang/main.cpp
    src/main/cpp/oreslang/frontend/Parser.cpp
    src/main/cpp/oreslang/types/OwnershipChecker.cpp
    src/main/cpp/oreslang/backend/LlvmCodegen.cpp
)

target_include_directories(oreslang-llvmc PRIVATE
    "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp"
    "${LLVM_INCLUDE_DIRS}"
)
add_definitions(${LLVM_DEFINITIONS})
llvm_map_components_to_libnames(ORE_LLVM_LIBS core support)
target_link_libraries(oreslang-llvmc PRIVATE ${ORE_LLVM_LIBS})

include(CTest)
if(BUILD_TESTING)
    add_executable(oreslang-owned-i64-region-security-test
        tests/native_owned_region_security_test.c
        src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c)
    target_include_directories(oreslang-owned-i64-region-security-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_definitions(oreslang-owned-i64-region-security-test PRIVATE
        ORESLANG_NATIVE_TEST_TOKEN_EXHAUSTION=1)
    target_compile_options(oreslang-owned-i64-region-security-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_owned_region_slot_security
        COMMAND oreslang-owned-i64-region-security-test)
    set_tests_properties(native_owned_region_slot_security PROPERTIES TIMEOUT 25)
    find_package(Python3 COMPONENTS Interpreter REQUIRED)
    find_program(ORE_CLANG NAMES clang clang-19 clang-18 clang-17 clang-16 clang-15 clang-14)
    find_program(ORE_NODE NAMES node nodejs)
    if(ORE_CLANG AND ORE_NODE)
        add_test(NAME wasm32_source_class_ownership_runtime
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/wasm32_owned_classes_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --node "${ORE_NODE}"
                --fixtures "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures")
        set_tests_properties(wasm32_source_class_ownership_runtime PROPERTIES TIMEOUT 240)
    endif()
    function(oreslang_contract_test name fixture)
        add_test(NAME ${name}
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/contract.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --fixture "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/${fixture}"
                ${ARGN})
    endfunction()

    add_executable(oreslang-ownership-cfg-dataflow-test
        tests/ownership_cfg_dataflow_test.cpp)
    target_include_directories(oreslang-ownership-cfg-dataflow-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-ownership-cfg-dataflow-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_ownership_cfg_dataflow_fixed_point
        COMMAND oreslang-ownership-cfg-dataflow-test)
    # Field-wise native destruction verifier and concrete owner flags.
    # Separate from unsupported source-level nontrivial class drop glue.
    add_executable(oreslang-ownership-drop-plan-test
        tests/ownership_drop_plan_test.cpp)
    target_include_directories(oreslang-ownership-drop-plan-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-ownership-drop-plan-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_ownership_cfg_exact_once_field_destruction
        COMMAND oreslang-ownership-drop-plan-test)
    add_executable(oreslang-dop-kernel-test tests/dop_kernel_lowering_test.cpp)
    target_include_directories(oreslang-dop-kernel-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-dop-kernel-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME dop_typed_cpu_opencl_ownership COMMAND oreslang-dop-kernel-test)
    add_executable(oreslang-quantum-circuit-test tests/quantum_circuit_lowering_test.cpp)
    target_include_directories(oreslang-quantum-circuit-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-quantum-circuit-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME quantum_circuit_qasm3_simulator COMMAND oreslang-quantum-circuit-test)
    add_executable(oreslang-gpu-fence-test tests/gpu_buffer_fence_test.cpp)
    target_include_directories(oreslang-gpu-fence-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-gpu-fence-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME gpu_device_generation_quiescence_fences COMMAND oreslang-gpu-fence-test)

    oreslang_contract_test(constant_main constant-main.ores --ir "ret i64 42")
    add_test(NAME native_explicit_wasm32_target_ir
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/wasm32_target_ir_test.py"
            "$<TARGET_FILE:oreslang-llvmc>"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/constant-main.ores")
    oreslang_contract_test(module_main module-main.ores --ir "demo.main")
    oreslang_contract_test(call_and_forward_ref forward-call-main.ores --ir "call i64 @add")
    # Same exact public Oreslang handler fixture as Java/Graal; execute native code.
    if(ORE_CLANG)
        oreslang_contract_test(shared_java_llvm_http_handler http-guest-counter-handler.ores --ir "call i64 @counter_response" --run 43 --clang "${ORE_CLANG}")
        add_test(NAME shared_java_llvm_128_call_matrix
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/shared_guest_handler_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --fixture "${CMAKE_CURRENT_SOURCE_DIR}/tests/fixtures/http-guest-counter-handler.ores")
    endif()
    # Bounded synchronous defer: LIFO calls on taken/fallthrough return CFG edges.
    if(ORE_CLANG)
        oreslang_contract_test(native_defer_lifo_guarded_execution native-defer-lifo-cfg.ores
            --ir "call void @multiply_ten" --run 111 --clang "${ORE_CLANG}")
    endif()
    if(ORE_CLANG)
        oreslang_contract_test(native_defer_multiguard_cfg_exit_execution native-defer-multiguard-cfg.ores
            --ir "call void @multiply_two" --run 15 --clang "${ORE_CLANG}")
    endif()
    oreslang_contract_test(reject_native_defer_noncall native-defer-noncall-reject.ores
        --diagnostic "native defer requires a direct function call")
    oreslang_contract_test(reject_native_defer_moved_return native-defer-moved-after-return.ores
        --diagnostic "borrow of explicitly moved int")
    # Native return snapshot is immutable under subsequent deferred field cleanup.
    if(ORE_CLANG)
        oreslang_contract_test(native_defer_field_return_snapshot native-defer-field-return.ores
            --ir "return.guard.eq" --run 222 --clang "${ORE_CLANG}")
    endif()
    oreslang_contract_test(reject_native_defer_field_shared_borrow
        native-defer-field-shared-borrow-reject.ores
        --diagnostic "cannot mutate through shared class borrow")
    oreslang_contract_test(reject_native_defer_field_moved_return
        native-defer-field-moved-after-return-reject.ores
        --diagnostic "not definitely initialized")
    oreslang_contract_test(reject_native_deferred_return_rebinding
        native-defer-return-rebinding-reject.ores
        --diagnostic "native defer requires a direct function call or class field assignment")
    oreslang_contract_test(reject_native_finally_override
        native-defer-finally-unsupported.ores
        --diagnostic "native exception/control effect unsupported")
    # Native source if/else CFG: separate branch states must join safely.
    # Real Clang execution, ASan/UBSan and no-partial-IR rejection matrix.
    if(ORE_CLANG)
        add_test(NAME native_source_conditional_cfg
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/conditional_cfg_native_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}")
        add_test(NAME native_source_conditional_cfg_asan_ubsan
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/conditional_cfg_native_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}" --sanitize)
        set_tests_properties(native_source_conditional_cfg
            native_source_conditional_cfg_asan_ubsan PROPERTIES TIMEOUT 180)
    endif()
    # Synchronous branch-scoped i64 lifetimes cannot escape the owning arm.
    if(ORE_CLANG)
        add_test(NAME native_branch_local_scope_source_execution
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/branch_local_cfg_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>" --clang "${ORE_CLANG}")
        add_test(NAME native_branch_local_scope_asan_ubsan
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/branch_local_cfg_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}" --sanitize)
        set_tests_properties(native_branch_local_scope_source_execution
            native_branch_local_scope_asan_ubsan PROPERTIES TIMEOUT 180)
    endif()
    oreslang_contract_test(arithmetic_precedence return-arithmetic.ores --ir "ret i64 28")
    oreslang_contract_test(negative_literal negative-literal.ores --ir "ret i64 42")
    oreslang_contract_test(nested_comments nested-comments.ores --ir "ret i64 42")
    oreslang_contract_test(native_owned_lexical_lifetime owned-lexical-main.ores --no-native-abi --ir "llvm.lifetime.end")
    oreslang_contract_test(native_owned_identifier owned-identifier-main.ores --no-native-abi --ir "call i64 @owned")
    # Port the unique generated stress corpus from old stacked #72 without its
    # outdated frontend/backend implementation. This compiles + runs native IR.
    if(ORE_CLANG)
        add_test(NAME native_owned_scalar_cfg_generated_stress
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/owned_syntax_stress.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --native-runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c")
        set_tests_properties(native_owned_scalar_cfg_generated_stress PROPERTIES TIMEOUT 240)
    endif()
    # Class moves are compiled and exercised through real native guests.
    if(ORE_CLANG)
        add_test(NAME native_class_move_source_execution
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/class_move_native_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>" --clang "${ORE_CLANG}")
        add_test(NAME native_class_move_source_asan_ubsan
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/class_move_native_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>" --clang "${ORE_CLANG}" --sanitize)
        set_tests_properties(native_class_move_source_execution
            native_class_move_source_asan_ubsan PROPERTIES TIMEOUT 180)
    endif()
    oreslang_contract_test(reject_owned_int_without_opt_in owned-native-region-main.ores --diagnostic "experimental owned int requires --experimental-owned-int")
    oreslang_contract_test(owned_native_heap_lowering owned-native-region-main.ores --experimental-owned-int --ir "call void @oreslang_owned_i64_region_drop")
    oreslang_contract_test(owned_native_region_nested owned-native-region-call.ores --experimental-owned-int --ir "call void @oreslang_owned_i64_region_close")
    oreslang_contract_test(reject_unsupported_native_heap_type owned-native-region-unsupported.ores --experimental-owned-int --diagnostic "expected 'int'")
    oreslang_contract_test(reject_local_uninitialized owned-uninitialized.ores --diagnostic "unknown parameter")
    oreslang_contract_test(reject_local_duplicate owned-duplicate.ores --diagnostic "duplicate owned local")
    oreslang_contract_test(reject_local_forward_reference owned-use-before-declaration.ores --diagnostic "unknown parameter")
    oreslang_contract_test(reject_local_unsupported_object owned-unsupported-heap.ores --diagnostic "expected int expression")
    oreslang_contract_test(reject_local_moved_before_read owned-local-use-after-take.ores --diagnostic "use of explicitly moved int")
    oreslang_contract_test(native_owned_local_shared_borrow owned-local-shared-borrow.ores --ir "llvm.lifetime.end")
    oreslang_contract_test(native_owned_local_mutable_borrow owned-local-mutable-borrow.ores --ir "llvm.lifetime.end")
    oreslang_contract_test(reject_actor unsupported-actor.ores --diagnostic "actor requires at least one scalar field")
    # Host-only ActorGroup substrate: source actor spawn/await fail closed.
    oreslang_contract_test(reject_native_actor_group_spawn unsupported-actor-group-spawn.ores --diagnostic "expected int expression")
    oreslang_contract_test(reject_native_actor_group_await_spawn unsupported-actor-group-await-spawn.ores --diagnostic "native async/channel/select boundary unsupported")

    # ActorRef<T> is a source-checked non-Copy capability; Future<T> remains
    # explicitly blocked until compiler-generated suspension is lowered.
    oreslang_contract_test(source_actor_typed_ref_admit source-actor-typed-ref.ores
        --ir "oreslang_source_actor_spawn")
    oreslang_contract_test(source_actor_typed_ref_mismatch source-actor-typed-ref-mismatch.ores
        --diagnostic "ActorRef<T> type mismatch")
    oreslang_contract_test(source_actor_typed_ref_nonspawn source-actor-typed-ref-nonspawn.ores
        --diagnostic "ActorRef<T> requires spawn initializer")
    oreslang_contract_test(source_future_typed_await_boundary source-future-typed-unimplemented.ores
        --diagnostic "Future<T> requires native continuation lowering")

    # Real source-compiled Oreslang actors, not host-only C callback tests.
    # The synchronous stop barrier is allowed only in trusted top-level main.
    # Source await/select/Futures still fail closed pending pinned-frame lowering.
    if(ORE_CLANG)
        add_test(NAME source_actor_compiled_native_lifecycle
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/source_actor_e2e.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --root "${CMAKE_CURRENT_SOURCE_DIR}")
        set_tests_properties(source_actor_compiled_native_lifecycle PROPERTIES TIMEOUT 90)
        add_test(NAME source_actor_compiled_native_asan_ubsan
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/source_actor_e2e.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --root "${CMAKE_CURRENT_SOURCE_DIR}" --sanitize)
        set_tests_properties(source_actor_compiled_native_asan_ubsan PROPERTIES TIMEOUT 90)
    endif()

    add_executable(oreslang-actor-group-lifecycle-test tests/actor_group_lifecycle_test.cpp)
    target_include_directories(oreslang-actor-group-lifecycle-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-actor-group-lifecycle-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_libraries(oreslang-actor-group-lifecycle-test PRIVATE Threads::Threads)
    add_test(NAME native_actor_group_managed_worker_readiness COMMAND oreslang-actor-group-lifecycle-test)
    set_tests_properties(native_actor_group_managed_worker_readiness PROPERTIES TIMEOUT 15)
    # Cooperation membership is many-to-many, distinct from one lifecycle owner.
    add_executable(oreslang-native-actor-membership-test tests/native_actor_membership_test.cpp)
    target_include_directories(oreslang-native-actor-membership-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-native-actor-membership-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    target_link_libraries(oreslang-native-actor-membership-test PRIVATE Threads::Threads)
    add_test(NAME native_actor_multi_group_membership COMMAND oreslang-native-actor-membership-test)
    set_tests_properties(native_actor_multi_group_membership PROPERTIES TIMEOUT 20)
    # Pinned native Future<void> lifecycle frame: host callbacks only record
    # completion; resumption is admitted on a parent actor's CONTROL lane.
    # Guest-source await remains compiler-rejected pending typed MIR lowering.
    add_executable(oreslang-actor-lifecycle-await-test tests/actor_lifecycle_await_test.cpp)
    target_include_directories(oreslang-actor-lifecycle-await-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-actor-lifecycle-await-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    target_link_libraries(oreslang-actor-lifecycle-await-test PRIVATE Threads::Threads)
    add_test(NAME native_pinned_actor_future_control_continuation
        COMMAND oreslang-actor-lifecycle-await-test)
    set_tests_properties(native_pinned_actor_future_control_continuation PROPERTIES TIMEOUT 15)
    add_executable(oreslang-bounded-actor-port-test tests/bounded_actor_port_test.cpp)
    target_include_directories(oreslang-bounded-actor-port-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-bounded-actor-port-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_port_bounded_owned_transport COMMAND oreslang-bounded-actor-port-test)
    # Prove control-plane stop requests honor existing loan-gated native heaps.
    add_executable(oreslang-actor-group-heap-quiescence-test
        tests/actor_group_heap_quiescence_test.cpp
        src/main/cpp/oreslang/runtime/ActorOwnedI64Heap.c)
    target_include_directories(oreslang-actor-group-heap-quiescence-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-actor-group-heap-quiescence-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    target_link_libraries(oreslang-actor-group-heap-quiescence-test PRIVATE Threads::Threads)
    add_test(NAME native_actor_group_heap_loan_quiescence
        COMMAND oreslang-actor-group-heap-quiescence-test)
    set_tests_properties(native_actor_group_heap_loan_quiescence PROPERTIES TIMEOUT 15)
    oreslang_contract_test(reject_gpu_kernel unsupported-gpu-kernel.ores --diagnostic "native gpu/quantum boundary unsupported")
    oreslang_contract_test(reject_quantum_kernel unsupported-quantum-kernel.ores --diagnostic "native gpu/quantum boundary unsupported")
    oreslang_contract_test(reject_gpu_expression unsupported-gpu-expression.ores --diagnostic "native gpu/quantum boundary unsupported")
    add_executable(oreslang-dop-layout-test tests/dop_layout_test.cpp)
    target_include_directories(oreslang-dop-layout-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-dop-layout-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME dop_layout_checked_geometry COMMAND oreslang-dop-layout-test)
    # Nonescaping int loans are supported at checked call boundaries only;
    # a reference still cannot be returned or stored, or cross suspension.
    oreslang_contract_test(reject_rt_borrow unsupported-rt-borrow.ores --diagnostic "borrowed reference may only be passed")
    oreslang_contract_test(native_borrowed_parameter unsupported-borrowed-parameter.ores --ir "load i64")
    oreslang_contract_test(reject_rt_borrow_mut unsupported-rt-borrow-mut.ores --diagnostic "borrowed reference may only be passed")
    oreslang_contract_test(reject_rt_take unsupported-rt-take.ores --diagnostic "unknown parameter")
    oreslang_contract_test(reject_rt_copy unsupported-rt-copy.ores --diagnostic "unknown parameter")
    oreslang_contract_test(reject_rt_share unsupported-rt-share.ores --diagnostic "unknown parameter")
    oreslang_contract_test(reject_unqualified_borrow_call unsupported-borrow-function.ores --diagnostic "expected int expression")
    oreslang_contract_test(reject_suspends unsupported-suspends.ores --diagnostic "native suspends declaration requires")
    oreslang_contract_test(reject_critical unsupported-critical.ores --diagnostic "native critical declaration requires")
    oreslang_contract_test(reject_suspend_critical unsupported-suspend-critical.ores --diagnostic "native suspends declaration requires")
    add_executable(oreslang-critical-gate-test tests/critical_gate_test.cpp)
    target_include_directories(oreslang-critical-gate-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    find_package(Threads REQUIRED)
    target_link_libraries(oreslang-critical-gate-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-critical-gate-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_logical_critical_gate COMMAND oreslang-critical-gate-test)
    add_executable(oreslang-logical-mutex-test tests/logical_mutex_test.cpp)
    target_include_directories(oreslang-logical-mutex-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-logical-mutex-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-logical-mutex-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_logical_mutex_fifo_and_cancellation COMMAND oreslang-logical-mutex-test)
    # Host policy only; guest exceptional effects remain rejected.
    add_executable(oreslang-native-exception-policy-test tests/native_exception_policy_test.cpp)
    target_include_directories(oreslang-native-exception-policy-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-native-exception-policy-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_exception_failure_precedence_and_diagnostics
             COMMAND oreslang-native-exception-policy-test)
    add_test(NAME native_reserved_java_keywords
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/native_reserved_java_keywords.py"
            "$<TARGET_FILE:oreslang-llvmc>")
    oreslang_contract_test(reject_static_select unsupported-static-select.ores --diagnostic "native async/channel/select boundary unsupported")
    oreslang_contract_test(reject_dynamic_select_plan unsupported-dynamic-select-plan.ores --diagnostic "native async/channel/select boundary unsupported")
    # Until typed descriptor ownership and atomic selection land, source
    # SelectPlan factories and persistent case writes must fail closed.
    oreslang_contract_test(reject_select_plan_factory unsupported-select-plan-constructor.ores --diagnostic "expected ':'")
    oreslang_contract_test(reject_reusable_case_write unsupported-select-case-write.ores --diagnostic "expected ':'")
    oreslang_contract_test(reject_undefined undefined-name.ores --diagnostic "unknown parameter")

    # Native i64 is a Copy value: rt copy/rt share are scalar value copies,
    # while rt take invalidates named scalar binding until function exit.
    oreslang_contract_test(native_rt_copy_scalar native-rt-copy-scalar.ores --ir "ret i64 42")
    oreslang_contract_test(native_rt_take_scalar native-rt-take-scalar.ores --ir "ret i64 42")
    oreslang_contract_test(native_rt_share_scalar native-rt-share-scalar.ores --ir "ret i64 42")
    oreslang_contract_test(reject_take_then_reuse native-reject-take-then-reuse.ores --diagnostic "use of explicitly moved int")
    oreslang_contract_test(reject_take_call_arg_overlap native-reject-take-call-args.ores --diagnostic "use of explicitly moved int")
    oreslang_contract_test(reject_double_take native-reject-double-take.ores --diagnostic "use of explicitly moved int")
    oreslang_contract_test(native_loan_read_ir native-borrow-read.ores --ir "call i64 @inspect")
    oreslang_contract_test(native_loan_exclusive_ir native-borrow-exclusive.ores --ir "call i64 @inspect_mut")
    oreslang_contract_test(native_reborrow_shared_ir native-reborrow-shared.ores --ir "call i64 @inspect")
    oreslang_contract_test(native_reborrow_mut_ir native-reborrow-mut.ores --ir "call i64 @inspect_mut")
    oreslang_contract_test(native_reborrow_mut_to_shared_ir native-reborrow-mut-shared.ores --ir "call i64 @inspect")
    add_test(NAME native_ownership_async_boundary_matrix
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/native_ownership_boundary_matrix.py"
            "$<TARGET_FILE:oreslang-llvmc>")
    # LLVM has no native I/O binding registry or continuation lowering yet.
    # Both spellings must fail closed with no IR until implementation lands.
    oreslang_contract_test(reject_unsupported_native_io_blocking unsupported-native-io-blocking.ores --diagnostic "unknown function or wrong call arity")
    oreslang_contract_test(reject_unsupported_native_io_bare unsupported-native-io-bare.ores --diagnostic "unknown function or wrong call arity")
    oreslang_contract_test(reject_unverified_target_header unsupported-target-header.ores --diagnostic "native target admission unsupported")
    # Neither naming style is permitted without a typed I/O registry, async
    # transport and continuation lowering. No IR may be emitted on failure.
    add_test(NAME native_async_only_io_boundary_matrix
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/native_async_io_boundary_matrix.py"
            "$<TARGET_FILE:oreslang-llvmc>")
    oreslang_contract_test(pure_user_blocking_suffix pure-user-blocking-suffix.ores --ir "call i64 @pure_math_blocking")
    # The terminal-state gate is a standalone native safety primitive, not
    # an async I/O reactor or source-level await implementation.
    add_executable(oreslang-async-io-operation-test tests/async_io_operation_test.cpp)
    target_include_directories(oreslang-async-io-operation-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    find_package(Threads REQUIRED)
    target_link_libraries(oreslang-async-io-operation-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-async-io-operation-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_async_io_completion_generation_races COMMAND oreslang-async-io-operation-test)
    set_tests_properties(native_async_io_completion_generation_races PROPERTIES TIMEOUT 20)
    # Pre-source-lowering safety gate: prevents stale continuation wakeups,
    # premature actor-heap retirement, duplicate resumes and live-loan drops.
    add_executable(oreslang-pinned-continuation-gate-test tests/pinned_continuation_gate_test.cpp)
    target_include_directories(oreslang-pinned-continuation-gate-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-pinned-continuation-gate-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-pinned-continuation-gate-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_pinned_continuation_loan_cancel_quiescence
             COMMAND oreslang-pinned-continuation-gate-test)
    set_tests_properties(native_pinned_continuation_loan_cancel_quiescence PROPERTIES TIMEOUT 30)
    # Real actor-owned fixed-field loans must survive logical suspension
    # without permitting mutation, cancellation-time drop, or cross-actor alias.
    if(UNIX)
        add_executable(oreslang-pinned-actor-heap-suspend-test
            tests/pinned_actor_heap_suspend_test.cpp
            src/main/cpp/oreslang/runtime/ActorOwnedI64Heap.c)
        target_include_directories(oreslang-pinned-actor-heap-suspend-test PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
        target_compile_options(oreslang-pinned-actor-heap-suspend-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
        target_link_libraries(oreslang-pinned-actor-heap-suspend-test PRIVATE Threads::Threads)
        add_test(NAME native_pinned_actor_heap_suspend_cancel_quiescence
                 COMMAND oreslang-pinned-actor-heap-suspend-test)
        set_tests_properties(native_pinned_actor_heap_suspend_cancel_quiescence PROPERTIES TIMEOUT 30)
    endif()
    oreslang_contract_test(reject_wrong_arity wrong-arity.ores --diagnostic "wrong call arity")
    oreslang_contract_test(reject_duplicates duplicate-function.ores --diagnostic "duplicate function")
    oreslang_contract_test(reject_duplicate_parameters duplicate-parameter.ores --diagnostic "duplicate parameter")
    oreslang_contract_test(reject_oversized_integer overflow-integer.ores --diagnostic "overflows signed 64-bit")
    oreslang_contract_test(reject_unclosed_comment unclosed-comment.ores --diagnostic "unterminated block comment")
    # Source-level bounded class ownership and per-call shared/exclusive loans.
    # All class records are stack allocated; unverified class shapes and
    # by-value object parameters remain compile-time errors with no IR.
    # Primitive i64 field takes/reinitializations admit checked partial-state
    # ownership. Nontrivial drop/region transfer remains compile-time rejected.
    add_test(NAME native_field_and_region_move_admission
        COMMAND "${Python3_EXECUTABLE}"
            "${CMAKE_CURRENT_SOURCE_DIR}/tests/native_class_field_move_admission.py"
            --compiler "$<TARGET_FILE:oreslang-llvmc>")
    set_tests_properties(native_field_and_region_move_admission PROPERTIES TIMEOUT 90)
    # Executable transfer + exact-once conditional owned-region drop flags.
    # Wasm has no native region ABI; unsafe transfers must reject with no IR.
    if(ORE_CLANG)
        add_test(NAME native_owned_region_conditional_drop_matrix
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/owned_region_conditional_drop_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c"
                --include "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
        set_tests_properties(native_owned_region_conditional_drop_matrix PROPERTIES TIMEOUT 240)
        add_test(NAME native_owned_region_conditional_drop_sanitized
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/owned_region_conditional_drop_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c"
                --include "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp" --sanitize)
        set_tests_properties(native_owned_region_conditional_drop_sanitized PROPERTIES TIMEOUT 240)
        add_test(NAME native_single_cleanup_epilogue
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/native_single_cleanup_epilogue_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c"
                --include "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
        add_test(NAME native_single_cleanup_epilogue_sanitized
            COMMAND "${Python3_EXECUTABLE}"
                "${CMAKE_CURRENT_SOURCE_DIR}/tests/native_single_cleanup_epilogue_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c"
                --include "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp" --sanitize)
        set_tests_properties(native_single_cleanup_epilogue
            native_single_cleanup_epilogue_sanitized PROPERTIES TIMEOUT 240)
    endif()
    oreslang_contract_test(class_reject_byvalue_mutation class-mutation-byvalue-reject.ores --diagnostic "ownership violation")
    # This is the *exact same Git blob* as the Java/Graal conformance
    # source (contracts/v1/semantics/fixtures/ownership.ores), not a
    # purpose-built LLVM-only approximation. A generic parse failure
    # does NOT count as an ownership diagnostic.
    add_test(NAME class_exact_shared_ownership_diagnostic
        COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/contract.py"
            --compiler "$<TARGET_FILE:oreslang-llvmc>"
            --fixture "${CMAKE_CURRENT_SOURCE_DIR}/contracts/v1/semantics/fixtures/ownership.ores"
            --diagnostic "ownership violation")

    oreslang_contract_test(class_reject_shared_mutation class-shared-mutation-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_overlapping_borrows class-double-borrow-reject.ores --diagnostic "conflicting active native borrow")
    oreslang_contract_test(class_reject_unknown_field class-unknown-field-reject.ores --diagnostic "unknown class field")
    oreslang_contract_test(class_reject_noncopy_value class-noncopy-return-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_suspend_boundary class-async-borrow-reject.ores --diagnostic "native async/channel/select boundary unsupported")
    oreslang_contract_test(class_admit_ordered_legacy_two_field_layout class-unsupported-layout-reject.ores)
    oreslang_contract_test(class_reject_duplicate_field class-multifield-duplicate-field-reject.ores --diagnostic "duplicate class field")
    oreslang_contract_test(class_reject_nonint_nested_field class-multifield-nonint-field-reject.ores --diagnostic "expected 'int'")
    oreslang_contract_test(class_reject_shared_write_secondary class-multifield-shared-write-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_overlap_across_fields class-multifield-overlap-reject.ores --diagnostic "conflicting active native borrow")
    oreslang_contract_test(class_reject_immutable_exclusive_loan class-immutable-owner-mut-borrow-reject.ores --diagnostic "cannot mutably borrow immutable owner")
    oreslang_contract_test(class_reject_immutable_owner_field_write class-immutable-owner-field-write-reject.ores --diagnostic "class mutation requires let mut owner")
    oreslang_contract_test(class_reject_unknown_secondary_field class-multifield-unknown-field-reject.ores --diagnostic "unknown class field")
    oreslang_contract_test(class_reject_byvalue_multifield_move class-multifield-byvalue-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_taken_field_reuse class-field-use-after-take-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_field_take_on_borrowed_owner class-field-borrowed-take-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_whole_borrow_of_partially_moved_object class-field-borrow-partial-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(class_reject_actor_send_after_move source-actor-send-after-take-reject.ores --diagnostic "use of explicitly moved int")
    oreslang_contract_test(class_reject_actor_borrowed_payload source-actor-send-borrow-reject.ores --diagnostic "borrowed reference may only be passed")
    oreslang_contract_test(cfg_reject_impure_move_condition cfg-guard-impure-take-reject.ores --diagnostic "native guarded condition must be pure")
    oreslang_contract_test(cfg_reject_impure_call_condition cfg-guard-impure-call-reject.ores --diagnostic "native guarded condition must be pure")
    oreslang_contract_test(cfg_reject_multifield_class_return cfg-multifield-branch-noncopy-reject.ores --diagnostic "ownership violation")
    oreslang_contract_test(cfg_reject_multifield_call_in_condition cfg-multifield-guard-call-reject.ores --diagnostic "native guarded condition must be pure")
    oreslang_contract_test(cfg_reject_missing_fallthrough cfg-guard-missing-final-reject.ores --diagnostic "expected 'return'")
    oreslang_contract_test(cfg_reject_missing_fi cfg-guard-missing-fi-reject.ores --diagnostic "expected 'fi'")
    oreslang_contract_test(cfg_reject_void_guard cfg-guard-void-reject.ores --diagnostic "guarded early return requires int result")




    if(ORE_CLANG)
        oreslang_contract_test(class_exec_mutable_borrow class-mutable-borrow-native.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(class_exec_shared_read class-shared-read-native.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(class_exec_mut_to_shared_reborrow class-reborrow-native.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(class_exec_owned_stack_field class-owned-field-native.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(class_exec_field_take_reinitialization class-field-take-reinit-native.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(class_exec_cfg_branch_field_take class-field-take-branch-native.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(class_exec_two_field_mutator class-multifield-mutator.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(cfg_exec_mutated_multifield_early_true cfg-multifield-mutator-early-true.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(cfg_exec_mutated_multifield_early_false cfg-multifield-mutator-early-false.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(class_exec_three_field_mutator class-multifield-independent-write.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(cfg_exec_multifield_guard_taken cfg-multifield-guard-true.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi --ir "guard.return")
        oreslang_contract_test(cfg_exec_multifield_guard_fallthrough cfg-multifield-guard-false.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi --ir "guard.next")
        oreslang_contract_test(cfg_exec_multifield_guard_chain cfg-multifield-guard-chain.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(cfg_exec_scalar_branch_move cfg-scalar-branch-move.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        oreslang_contract_test(cfg_exec_experimental_owned_early_drop cfg-heap-owned-early-drop.ores --experimental-owned-int --run 42 --clang "${ORE_CLANG}" --native-runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c" --ir "guard.return")
        add_test(NAME cfg_guarded_drop_all_native_exit_edges
            COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/guarded_cfg_drop_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}"
                --native-runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c")
        set_tests_properties(cfg_guarded_drop_all_native_exit_edges PROPERTIES TIMEOUT 240)
        oreslang_contract_test(class_exec_two_field_shared_read class-multifield-shared-read.ores --run 42 --clang "${ORE_CLANG}" --no-native-abi)
        add_test(NAME class_native_1_to_16_field_layout_matrix
            COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/class_multifield_layout_matrix.py"
                --compiler "$<TARGET_FILE:oreslang-llvmc>"
                --clang "${ORE_CLANG}")
        set_tests_properties(class_native_1_to_16_field_layout_matrix PROPERTIES TIMEOUT 240)
        oreslang_contract_test(native_exec_constant constant-main.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_forward_call forward-call-main.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_arithmetic return-arithmetic.ores --run 28 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_negative negative-literal.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_lexical_local owned-lexical-main.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_owned_identifier owned-identifier-main.ores --no-native-abi --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_owned_region owned-native-region-main.ores --experimental-owned-int --run 42 --clang "${ORE_CLANG}" --native-runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c")
        oreslang_contract_test(native_exec_owned_region_nested owned-native-region-call.ores --experimental-owned-int --run 42 --clang "${ORE_CLANG}" --native-runtime "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c")
        oreslang_contract_test(native_exec_lexical_shared_loan owned-local-shared-borrow.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_lexical_mutable_loan owned-local-mutable-borrow.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_rt_copy_scalar native-rt-copy-scalar.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_rt_take_scalar native-rt-take-scalar.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_rt_share_scalar native-rt-share-scalar.ores --run 42 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_loan_read native-borrow-read.ores --run 83 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_loan_exclusive native-borrow-exclusive.ores --run 40 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_reborrow_shared native-reborrow-shared.ores --run 81 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_reborrow_mut native-reborrow-mut.ores --run 40 --clang "${ORE_CLANG}")
        oreslang_contract_test(native_exec_reborrow_mut_to_shared native-reborrow-mut-shared.ores --run 41 --clang "${ORE_CLANG}")
    else()
        message(WARNING "Clang unavailable: native executable tests are disabled")
    endif()

    # Inert native POD allocator: deterministic ownership without tracing GC.
    # The test does not establish compiler-enforced object lifetime parity.
    # Bounded native region with provenance-checked deterministic scalar drops.
    add_executable(oreslang-native-owned-i64-region-test
        tests/native_owned_region_test.c
        src/main/cpp/oreslang/runtime/NativeOwnedI64Region.c)
    target_include_directories(oreslang-native-owned-i64-region-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-native-owned-i64-region-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_owned_i64_region_drop_and_provenance
        COMMAND oreslang-native-owned-i64-region-test)

    # Host-only deterministic actor arena; no source actor lowering implied.
    add_executable(oreslang-native-actor-arena-test
        tests/native_actor_arena_test.c
        src/main/cpp/oreslang/runtime/ActorArena.c)
    target_include_directories(oreslang-native-actor-arena-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-actor-arena-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-actor-arena-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_arena_persistent_scratch
        COMMAND oreslang-native-actor-arena-test)
    set_tests_properties(native_actor_arena_persistent_scratch PROPERTIES TIMEOUT 25)

    # Persist actor-native data across message turns and carrier migration.
    # Retirement denies new admissions; physical free waits for active loans.
    find_package(Threads REQUIRED)
    add_executable(oreslang-actor-owned-i64-heap-test
        tests/actor_owned_heap_lifecycle_test.c
        src/main/cpp/oreslang/runtime/ActorOwnedI64Heap.c)
    target_include_directories(oreslang-actor-owned-i64-heap-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-actor-owned-i64-heap-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-actor-owned-i64-heap-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_owned_i64_heap_loan_quiescence
        COMMAND oreslang-actor-owned-i64-heap-test)
    set_tests_properties(native_actor_owned_i64_heap_loan_quiescence PROPERTIES TIMEOUT 20)

    add_executable(oreslang-fixed-arena-test tests/fixed_arena_test.cpp)
    target_include_directories(oreslang-fixed-arena-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-fixed-arena-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_fixed_arena_contract COMMAND oreslang-fixed-arena-test)

    add_executable(oreslang-deterministic-graph-arena-test tests/deterministic_graph_arena_test.cpp)
    target_include_directories(oreslang-deterministic-graph-arena-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_compile_options(oreslang-deterministic-graph-arena-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_deterministic_graph_arena COMMAND oreslang-deterministic-graph-arena-test)

    # Linux-specific actor-neutral wake/park primitive. This does NOT
    # implement the actor scheduler or certify lock-free mailbox delivery.
    if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
        find_package(Threads REQUIRED)
        add_executable(oreslang-parking-signal-test
            tests/parking_signal_test.cpp
            src/main/cpp/oreslang/runtime/ParkingSignal.cpp)
        target_include_directories(oreslang-parking-signal-test PRIVATE
            "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
        target_link_libraries(oreslang-parking-signal-test PRIVATE Threads::Threads)
        target_compile_options(oreslang-parking-signal-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME parking_signal_wake_cancel_races COMMAND oreslang-parking-signal-test)
        set_tests_properties(parking_signal_wake_cancel_races PROPERTIES TIMEOUT 25)

        add_executable(oreslang-hungry-carrier-test
            tests/hungry_carrier_test.cpp
            src/main/cpp/oreslang/runtime/HungryCarrier.cpp
            src/main/cpp/oreslang/runtime/ParkingSignal.cpp)
        target_include_directories(oreslang-hungry-carrier-test PRIVATE
            "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
        target_link_libraries(oreslang-hungry-carrier-test PRIVATE Threads::Threads)
        target_compile_options(oreslang-hungry-carrier-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME hungry_carrier_async_bounded_cancel
                 COMMAND oreslang-hungry-carrier-test)
        set_tests_properties(hungry_carrier_async_bounded_cancel PROPERTIES TIMEOUT 30)

        # Real native carrier admissions and handler observations are used to
        # produce an executable trace (not fabricated actor-model fixtures).
        add_executable(oreslang-actor-trace-test
            tests/actor_trace_integration.cpp
            src/main/cpp/oreslang/runtime/HungryCarrier.cpp
            src/main/cpp/oreslang/runtime/ParkingSignal.cpp)
        target_include_directories(oreslang-actor-trace-test PRIVATE
            "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
        target_link_libraries(oreslang-actor-trace-test PRIVATE Threads::Threads)
        target_compile_options(oreslang-actor-trace-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
        add_test(NAME native_actor_ingress_handler_trace
                 COMMAND oreslang-actor-trace-test)
        set_tests_properties(native_actor_ingress_handler_trace PROPERTIES TIMEOUT 15)
    endif()
    # Current-main reconciliation of the native actor substrate from draft
    # LLVM #118. Never replace the newer main ownership/continuation tests.
    # This admits host-level actor scheduling and reserved CONTROL only;
    # source-level spawn/await lowering remains a separate compiler gate.
    find_package(Threads REQUIRED)

    add_executable(oreslang-native-actor-mailbox-test
        tests/native_actor_mailbox_test.c
        src/main/cpp/oreslang/runtime/NativeActorMailbox.c)
    target_include_directories(oreslang-native-actor-mailbox-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-actor-mailbox-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-actor-mailbox-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_fifo_mailbox_admission
        COMMAND oreslang-native-actor-mailbox-test)
    set_tests_properties(native_actor_fifo_mailbox_admission PROPERTIES TIMEOUT 20)

    # VM-level ownership: four independent scheduler domains, five carriers
    # by default; cross-domain ActorRefs cannot be admitted by another pool.
    add_executable(oreslang-native-ores-vm-test
        tests/native_ores_vm_test.c
        src/main/cpp/oreslang/runtime/NativeOresVM.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c)
    target_include_directories(oreslang-native-ores-vm-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-ores-vm-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-ores-vm-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_ores_vm_four_carrier_domains
        COMMAND oreslang-native-ores-vm-test)
    set_tests_properties(native_ores_vm_four_carrier_domains PROPERTIES TIMEOUT 30)
    add_executable(oreslang-native-actor-ready-queue-test
        tests/native_actor_scheduler_test.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c)
    target_include_directories(oreslang-native-actor-ready-queue-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-actor-ready-queue-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-actor-ready-queue-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_nonblocking_ready_queue
        COMMAND oreslang-native-actor-ready-queue-test)
    set_tests_properties(native_actor_nonblocking_ready_queue PROPERTIES TIMEOUT 30)

    # Send and stop contend on one linearizable actor admission authority.
    add_executable(oreslang-native-send-stop-race-test
        tests/native_actor_send_stop_race_test.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c)
    target_include_directories(oreslang-native-send-stop-race-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-send-stop-race-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-send-stop-race-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_send_stop_linearizable_race
        COMMAND oreslang-native-send-stop-race-test)
    set_tests_properties(native_actor_send_stop_linearizable_race PROPERTIES TIMEOUT 30)

    # ActorRef scheduler domains are capabilities: exhaustion must not wrap
    # and concurrent opens near UINT64_MAX must never issue duplicates.
    add_executable(oreslang-native-domain-exhaustion-test
        tests/native_actor_domain_exhaustion_test.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c)
    target_include_directories(oreslang-native-domain-exhaustion-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-domain-exhaustion-test PRIVATE Threads::Threads)
    target_compile_definitions(oreslang-native-domain-exhaustion-test PRIVATE
        ORESLANG_NATIVE_TEST_DOMAIN_EXHAUSTION=1)
    target_compile_options(oreslang-native-domain-exhaustion-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actor_domain_exhaustion_no_reuse
        COMMAND oreslang-native-domain-exhaustion-test)
    set_tests_properties(native_actor_domain_exhaustion_no_reuse PROPERTIES TIMEOUT 30)

    # Stop one child without waiting for an unrelated actor's busy turn.
    add_executable(oreslang-native-child-wait-test
        tests/native_actor_group_wait_done_test.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c)
    target_include_directories(oreslang-native-child-wait-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-child-wait-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-child-wait-test PRIVATE
        -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_actorgroup_per_child_wait_done
        COMMAND oreslang-native-child-wait-test)
    set_tests_properties(native_actorgroup_per_child_wait_done PROPERTIES TIMEOUT 20)

    add_executable(oreslang-native-supervisor-control-test
        tests/native_supervisor_control_test.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c
        src/main/cpp/oreslang/runtime/NativeActorFuture.c)
    target_include_directories(oreslang-native-supervisor-control-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-supervisor-control-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-supervisor-control-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_supervisor_reserved_control_future
        COMMAND oreslang-native-supervisor-control-test)
    set_tests_properties(native_supervisor_reserved_control_future PROPERTIES TIMEOUT 30)

    add_executable(oreslang-native-supervisor-panic-test
        tests/native_supervisor_panic_test.c
        src/main/cpp/oreslang/runtime/NativeActorScheduler.c)
    target_include_directories(oreslang-native-supervisor-panic-test PRIVATE
        "${CMAKE_CURRENT_SOURCE_DIR}/src/main/cpp")
    target_link_libraries(oreslang-native-supervisor-panic-test PRIVATE Threads::Threads)
    target_compile_options(oreslang-native-supervisor-panic-test PRIVATE -Wall -Wextra -Wpedantic -Werror)
    add_test(NAME native_supervisor_typed_panic_event
        COMMAND oreslang-native-supervisor-panic-test)
    set_tests_properties(native_supervisor_typed_panic_event PROPERTIES TIMEOUT 30)
endif()

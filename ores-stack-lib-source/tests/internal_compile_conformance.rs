#[test]
fn internal_module_contract_compile_conformance() {
    let cases = trybuild::TestCases::new();
    cases.pass("tests/ui/pass_internal_module.rs");
    cases.compile_fail("tests/ui/fail_internal_non_send.rs");
}

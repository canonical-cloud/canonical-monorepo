#[test]
fn public_module_contract_compile_conformance() {
    let cases = trybuild::TestCases::new();
    cases.pass("tests/ui/pass_typed_module.rs");
    cases.compile_fail("tests/ui/fail_wrong_kind.rs");
    cases.compile_fail("tests/ui/fail_missing_send.rs");
}

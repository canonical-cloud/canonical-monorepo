use ores_stack_lib_core::{assert_internal_module, InternalModule, ModuleKind};

struct Good;

impl InternalModule for Good {
    type Input = String;
    type Output = String;
    type Error = ();
    type Context = ();

    const KIND: ModuleKind = ModuleKind::Rpc;
    const NAME: &'static str = "good_internal";

    async fn handle(
        &self,
        _context: &Self::Context,
        input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(input)
    }
}

const _: () = assert_internal_module::<Good>();

fn main() {}

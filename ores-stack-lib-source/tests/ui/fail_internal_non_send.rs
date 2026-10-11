use ores_stack_lib_core::{InternalModule, ModuleKind};
use std::rc::Rc;

struct Bad;

impl InternalModule for Bad {
    type Input = Rc<String>;
    type Output = ();
    type Error = ();
    type Context = ();

    const KIND: ModuleKind = ModuleKind::Worker;
    const NAME: &'static str = "bad_internal_send";

    async fn handle(
        &self,
        _context: &Self::Context,
        _input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(())
    }
}

fn main() {}

use ores_stack_pub_lib_core::{Lambda, TypedModule};
use std::rc::Rc;

struct Bad;

impl TypedModule for Bad {
    type Kind = Lambda;
    type Input = Rc<String>;
    type Output = ();
    type Error = ();
    type Context = ();

    const NAME: &'static str = "bad_send";

    async fn handle(
        &self,
        _context: &Self::Context,
        _input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(())
    }
}

fn main() {}

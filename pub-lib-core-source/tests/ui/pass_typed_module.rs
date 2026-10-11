use ores_stack_pub_lib_core::{assert_module, Lambda, TypedModule};

struct Good;

impl TypedModule for Good {
    type Kind = Lambda;
    type Input = String;
    type Output = String;
    type Error = ();
    type Context = ();

    const NAME: &'static str = "good";

    async fn handle(
        &self,
        _context: &Self::Context,
        input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(input)
    }
}

const _: () = assert_module::<Good>();

fn main() {}

use ores_stack_pub_lib_core::TypedModule;

struct NotAKind;
struct Bad;

impl TypedModule for Bad {
    type Kind = NotAKind;
    type Input = ();
    type Output = ();
    type Error = ();
    type Context = ();

    const NAME: &'static str = "bad_kind";

    async fn handle(
        &self,
        _context: &Self::Context,
        _input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(())
    }
}

fn main() {}

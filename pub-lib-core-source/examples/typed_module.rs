use ores_stack_pub_lib_core::{
    assert_module, static_descriptor, CancellationModel, Capability, ConcurrencyModel,
    InvocationMode, ModulePolicy, Rpc, StaticModuleDescriptor, TypedModule,
};

#[derive(Debug)]
struct Input;

#[derive(Debug)]
struct Output;

#[derive(Debug)]
struct ModuleError;

#[derive(Debug)]
struct ModuleContext;

struct CatalogLookupModule;

impl TypedModule for CatalogLookupModule {
    type Kind = Rpc;
    type Input = Input;
    type Output = Output;
    type Error = ModuleError;
    type Context = ModuleContext;

    const NAME: &'static str = "catalog_lookup";
    const POLICY: ModulePolicy = ModulePolicy {
        invocation: InvocationMode::RequestResponse,
        concurrency: ConcurrencyModel::Concurrent,
        cancellation: CancellationModel::Deadline,
        default_timeout_ms: 5_000,
        max_concurrency: Some(32),
        idempotent: true,
        retry_safe: true,
    };
    const CAPABILITIES: &'static [Capability] = &[Capability::Clock, Capability::DatabaseRead];

    async fn handle(
        &self,
        _context: &Self::Context,
        _input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(Output)
    }
}

const _: () = assert_module::<CatalogLookupModule>();
const MODULE_DESCRIPTOR: StaticModuleDescriptor = static_descriptor::<CatalogLookupModule>();

fn main() {
    assert_eq!(MODULE_DESCRIPTOR.name, "catalog_lookup");
    assert_eq!(MODULE_DESCRIPTOR.interface, "ores-stack.rpc.v1");
    assert_eq!(MODULE_DESCRIPTOR.capabilities.len(), 2);
}

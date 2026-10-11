use ores_stack_lib_core::{
    assert_internal_module, descriptor_for_internal, CancellationModel, Capability,
    ConcurrencyModel, InternalModule, InvocationMode, ModuleKind, ModulePolicy,
};

#[derive(Debug)]
struct Input;

#[derive(Debug)]
struct Output;

#[derive(Debug)]
struct ModuleError;

#[derive(Debug)]
struct ModuleContext;

struct CatalogWorkerModule;

impl InternalModule for CatalogWorkerModule {
    type Input = Input;
    type Output = Output;
    type Error = ModuleError;
    type Context = ModuleContext;

    const KIND: ModuleKind = ModuleKind::Worker;
    const NAME: &'static str = "catalog_worker";
    const POLICY: ModulePolicy = ModulePolicy {
        invocation: InvocationMode::Event,
        concurrency: ConcurrencyModel::Concurrent,
        cancellation: CancellationModel::Cooperative,
        default_timeout_ms: 30_000,
        max_concurrency: Some(16),
        idempotent: true,
        retry_safe: true,
    };
    const CAPABILITIES: &'static [Capability] = &[
        Capability::Clock,
        Capability::QueueConsume,
        Capability::DatabaseWrite,
    ];

    async fn handle(
        &self,
        _context: &Self::Context,
        _input: Self::Input,
    ) -> Result<Self::Output, Self::Error> {
        Ok(Output)
    }
}

const _: () = assert_internal_module::<CatalogWorkerModule>();

fn main() {
    let descriptor = descriptor_for_internal::<CatalogWorkerModule>(
        "crate::modules::catalog_worker::CatalogWorkerModule",
    );
    descriptor
        .validate()
        .expect("valid generated internal descriptor");
    assert_eq!(descriptor.kind, ModuleKind::Worker);
    assert_eq!(descriptor.interface, "ores-stack.worker.v1");
    assert_eq!(descriptor.capabilities.len(), 3);
}

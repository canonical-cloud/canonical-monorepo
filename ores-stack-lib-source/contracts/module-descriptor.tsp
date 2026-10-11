namespace OresStack.ModuleContracts;

alias ModuleContractVersion = "ores-stack-module-contract-v1";
alias ModuleSemanticsVersionV2 = "ores-stack.module-semantics/v2";
alias ModuleSemanticsVersionV3 = "ores-stack.module-semantics/v3";
alias ModuleSemanticsVersion = ModuleSemanticsVersionV2 | ModuleSemanticsVersionV3;

enum ModuleKind {
  lambda,
  http,
  rpc,
  page,
  middleware,
  worker,
}

enum InvocationMode {
  request_response,
  stream,
  event,
}

enum ConcurrencyModel {
  concurrent,
  serial,
  keyed_serial,
}

enum CancellationModel {
  cooperative,
  deadline,
}

enum PayloadCodec {
  json,
  messagepack,
  protobuf,
  utf8,
  bytes,
}

model PayloadContract {
  schema_ref?: string | null;
  content_type: string;
  codec: PayloadCodec;
}

model ModuleWireContract {
  request?: PayloadContract | null;
  /** Unary response body or, for stream invocation, one emitted item/chunk. */
  response?: PayloadContract | null;
}

enum Capability {
  clock,
  random,
  http_client,
  key_value_read,
  key_value_write,
  database_read,
  database_write,
  queue_publish,
  queue_consume,
  object_storage_read,
  object_storage_write,
  secrets_read,
  spawn,
  filesystem_read,
  filesystem_write,
}

model ModulePolicy {
  invocation: InvocationMode;
  concurrency: ConcurrencyModel;
  cancellation: CancellationModel;
  default_timeout_ms: uint64;
  max_concurrency: uint32 | null;
  idempotent: boolean;
  retry_safe: boolean;
}

model ModuleDescriptorBase {
  contract_version: ModuleContractVersion;
  semantics_version?: ModuleSemanticsVersion | null;
  name: string;
  entrypoint: string;
  policy?: ModulePolicy;
  capabilities?: Capability[];
  /** Present only with module semantics v3. */
  wire?: ModuleWireContract;
}

model LambdaModuleDescriptor extends ModuleDescriptorBase {
  kind: "lambda";
  interface: "ores-stack.lambda.v1";
}

model HttpModuleDescriptor extends ModuleDescriptorBase {
  kind: "http";
  interface: "ores-stack.http.v1";
}

model RpcModuleDescriptor extends ModuleDescriptorBase {
  kind: "rpc";
  interface: "ores-stack.rpc.v1";
}

model PageModuleDescriptor extends ModuleDescriptorBase {
  kind: "page";
  interface: "ores-stack.page.v1";
}

model MiddlewareModuleDescriptor extends ModuleDescriptorBase {
  kind: "middleware";
  interface: "ores-stack.middleware.v1";
}

model WorkerModuleDescriptor extends ModuleDescriptorBase {
  kind: "worker";
  interface: "ores-stack.worker.v1";
}

union ModuleDescriptor {
  lambda: LambdaModuleDescriptor,
  http: HttpModuleDescriptor,
  rpc: RpcModuleDescriptor,
  page: PageModuleDescriptor,
  middleware: MiddlewareModuleDescriptor,
  worker: WorkerModuleDescriptor,
}

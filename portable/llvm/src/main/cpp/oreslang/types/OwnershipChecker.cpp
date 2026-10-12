#include "oreslang/types/OwnershipChecker.hpp"
#include "oreslang/types/OwnershipCfg.hpp"

#include <functional>
#include <stdexcept>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace oreslang {
namespace {

using Mode = Parameter::Mode;
using Functions = std::unordered_map<std::string, const Function*>;

struct LocalOwnership {
    Mode mode = Mode::Value;
    bool moved = false;
    bool heap_owned = false; // Experimental region slots cannot transfer ownership yet.
    bool mutable_owner = false; // lexical let mut or exclusive borrowed parameter
    std::size_t shared_loans = 0;
    bool exclusive_loan = false;
    std::string class_name;
    std::unordered_set<std::string> class_fields;
    // Primitive i64 class fields can be moved and later restored by a write.
    std::unordered_set<std::string> moved_fields;
};
using Locals = std::unordered_map<std::string, LocalOwnership>;

[[noreturn]] void reject(const Expression& expr, const std::string& reason) {
    throw std::runtime_error(reason + " at byte " + std::to_string(expr.offset));
}

LocalOwnership& local(const Expression& expr, Locals& locals) {
    auto it = locals.find(expr.name);
    if (it == locals.end())
        reject(expr, "internal ownership error: undeclared parameter '" + expr.name + "'");
    return it->second;
}

void check_value(const Expression& expr, Locals& locals, const Functions& functions);

LocalOwnership& checked_field(const std::string& receiver, const std::string& field,
                               std::size_t offset, Locals& locals) {
    auto found = locals.find(receiver);
    if (found == locals.end() || found->second.class_name.empty() ||
            found->second.class_fields.count(field) == 0)
        throw std::runtime_error("unknown class field or receiver at byte " + std::to_string(offset));
    if (found->second.moved)
        throw std::runtime_error("ownership violation: use-after-move class field at byte " +
                                 std::to_string(offset));
    return found->second;
}

struct Loan {
    std::string name;
    bool exclusive = false;
};

// Only named, OWNED int parameter storage is currently addressable. A loan
// exists only as a call argument and must be returned at the call boundary.
// No borrow of a temporary, return of a reference, or reborrow of an existing
// borrowed parameter can enter native LLVM lowering.
Loan acquire(const Expression& expr, Mode expected, Locals& locals) {
    const bool exclusive = expr.kind == Expression::Kind::BorrowMut;
    if (expr.kind != Expression::Kind::Borrow &&
        expr.kind != Expression::Kind::BorrowMut)
        reject(expr, "borrowed argument requires explicit rt borrow [mut]");
    if ((expected == Mode::BorrowMut) != exclusive)
        reject(expr, "borrow mode does not match borrowed parameter");
    if (!expr.left || expr.left->kind != Expression::Kind::Variable)
        reject(expr, "native borrow requires an addressable named int parameter");
    LocalOwnership& source = local(*expr.left, locals);
    // A borrowed parameter has a caller-held lifetime and already carries
    // provenance to addressable i64 storage. A nested call can temporarily
    // reborrow that same storage, but it cannot strengthen a shared borrow
    // into a mutable one. Its new loan ends at that nested call's return.
    if (source.heap_owned && exclusive)
        reject(expr, "ownership violation: native owned int mutable borrow needs handle-aware writeback");
    if (source.mode == Mode::Borrow && exclusive)
        reject(expr, "cannot mutably reborrow shared parameter '" + expr.left->name + "'");
    if (exclusive && source.mode == Mode::Value && !source.mutable_owner)
        reject(expr, "cannot mutably borrow immutable owner '" + expr.left->name + "'");
    if (source.moved)
        reject(expr, (source.class_name.empty()
            ? "borrow of explicitly moved int '" : "ownership violation: borrow of moved class '")
            + expr.left->name + "'");
    if (!source.class_name.empty() && !source.moved_fields.empty())
        reject(expr, "ownership violation: cannot borrow a partially moved class '" +
            expr.left->name + "'");
    if (source.exclusive_loan || (exclusive && source.shared_loans != 0))
        reject(expr, "conflicting active native borrow of '" + expr.left->name + "'");
    if (exclusive) source.exclusive_loan = true;
    else ++source.shared_loans;
    return {expr.left->name, exclusive};
}

void release(const Loan& loan, Locals& locals) {
    auto& source = locals.at(loan.name);
    if (loan.exclusive) source.exclusive_loan = false;
    else --source.shared_loans;
}

void check_call(const Expression& expr, Locals& locals, const Functions& functions) {
    const auto found = functions.find(expr.name);
    if (found == functions.end())
        reject(expr, "internal ownership error: unresolved function");
    const auto& parameters = found->second->parameters;
    if (parameters.size() != expr.arguments.size())
        reject(expr, "internal ownership error: call arity mismatch");

    // Preserve the full set of argument loans until the call has completed.
    // Nested calls observe outstanding outer-call loans. Evaluation is
    // strictly left-to-right, matching the LLVM emitter.
    std::vector<Loan> loans;
    for (std::size_t i = 0; i < parameters.size(); ++i) {
        const Expression& argument = *expr.arguments[i];
        if (parameters[i].mode == Mode::Value) {
            if (!parameters[i].class_name.empty())
                reject(argument, "ownership violation: by-value class parameters require move/drop lowering");
            check_value(argument, locals, functions);
        } else {
            // Acquire first so malformed loans preserve the existing
            // precise diagnostics for temporaries and missing 'rt borrow'.
            Loan loan = acquire(argument, parameters[i].mode, locals);
            const auto& source = locals.at(loan.name);
            if (source.class_name != parameters[i].class_name)
                reject(argument, "ownership violation: borrowed argument type mismatch");
            loans.push_back(std::move(loan));
        }
    }
    for (auto it = loans.rbegin(); it != loans.rend(); ++it)
        release(*it, locals);
}

void check_value(const Expression& expr, Locals& locals, const Functions& functions) {
    switch (expr.kind) {
        case Expression::Kind::Integer:
            return;
        case Expression::Kind::Variable: {
            LocalOwnership& source = local(expr, locals);
            if (source.moved)
                reject(expr, "use of explicitly moved int '" + expr.name + "'");
            if (source.exclusive_loan)
                reject(expr, "read conflicts with active mutable borrow of '" + expr.name + "'");
            if (!source.class_name.empty())
                reject(expr, "ownership violation: class is non-Copy; use an explicit borrow");
            return;
        }
        case Expression::Kind::Field: {
            const auto& source = checked_field(expr.left->name, expr.name, expr.offset, locals);
            if (source.moved_fields.count(expr.name) != 0)
                reject(expr, "ownership violation: use-after-move class field '" +
                    expr.left->name + "." + expr.name + "'");
            if (source.exclusive_loan)
                reject(expr, "ownership violation: field read conflicts with active mutable borrow");
            return;
        }
        case Expression::Kind::Copy:
        case Expression::Kind::Share:
        case Expression::Kind::Negate:
            check_value(*expr.left, locals, functions);
            return;
        case Expression::Kind::Take: {
            // The bounded class subset has only trivially destructible i64
            // fields. Lowering a field take as a load is valid only because
            // checker state invalidates that place until an explicit write.
            check_value(*expr.left, locals, functions);
            if (expr.left->kind == Expression::Kind::Variable) {
                LocalOwnership& source = local(*expr.left, locals);
                if (source.mode != Mode::Value)
                    reject(expr, "cannot rt take through a borrowed parameter");
                // Experimental native owned-i64 values transfer the scalar,
                // drop their old heap slot immediately and disarm the
                // generated exit-time drop flag. The emitted native backend
                // must keep that conditional flag in sync with this move.
                if (source.exclusive_loan || source.shared_loans != 0)
                    reject(expr, "cannot move int while borrow is active");
                source.moved = true;
            } else if (expr.left->kind == Expression::Kind::Field) {
                const Expression& field = *expr.left;
                LocalOwnership& source = checked_field(
                    field.left->name, field.name, field.offset, locals);
                if (source.mode != Mode::Value)
                    reject(expr, "ownership violation: cannot take a class field through a borrowed parameter");
                if (source.exclusive_loan || source.shared_loans != 0)
                    reject(expr, "ownership violation: cannot take a class field with active loans");
                source.moved_fields.insert(field.name);
            }
            return;
        }
        case Expression::Kind::Add:
        case Expression::Kind::Subtract:
        case Expression::Kind::Multiply:
            check_value(*expr.left, locals, functions);
            check_value(*expr.right, locals, functions);
            return;
        case Expression::Kind::Call:
            if (functions.at(expr.name)->returns_void)
                reject(expr, "void call cannot be used as an int expression");
            check_call(expr, locals, functions);
            return;
        case Expression::Kind::Borrow:
        case Expression::Kind::BorrowMut:
            reject(expr, "borrowed reference may only be passed to a borrowed parameter");
    }
    reject(expr, "invalid native ownership expression kind");
}

// Guard conditions must not mutate ownership or execute calls with hidden
// effects. A taken return has its own ownership snapshot and cannot poison
// the distinct fallthrough path. This is *not* general branch-lifetime proof.
void check_pure_guard(const Expression& expr, Locals& locals, const Functions& functions) {
    switch (expr.kind) {
        case Expression::Kind::Integer:
        case Expression::Kind::Variable:
        case Expression::Kind::Field:
            check_value(expr, locals, functions);
            return;
        case Expression::Kind::Negate:
        case Expression::Kind::Copy:
        case Expression::Kind::Share:
            check_pure_guard(*expr.left, locals, functions);
            return;
        case Expression::Kind::Add:
        case Expression::Kind::Subtract:
        case Expression::Kind::Multiply:
            check_pure_guard(*expr.left, locals, functions);
            check_pure_guard(*expr.right, locals, functions);
            return;
        case Expression::Kind::Take:
        case Expression::Kind::Call:
        case Expression::Kind::Borrow:
        case Expression::Kind::BorrowMut:
            reject(expr, "native guarded condition must be pure and cannot move, call or borrow");
    }
    reject(expr, "unsupported guarded condition");
}

} // namespace

void validate_i64_ownership(const Program& program) {
    Functions functions;
    for (const auto& function : program.functions)
        functions.emplace(function.name, &function);
    std::unordered_map<std::string, std::unordered_set<std::string>> class_fields;
    for (const auto& cls : program.classes) {
        std::unordered_set<std::string> fields;
        for (const auto& field : cls.fields) fields.insert(field.name);
        class_fields.emplace(cls.name, std::move(fields));
    }
    for (const auto& function : program.functions) {
        Locals locals;
        for (const auto& param : function.parameters) {
            if (!param.class_name.empty()) {
                if (!class_fields.count(param.class_name))
                    throw std::runtime_error("unknown parameter class '" + param.class_name + "'");
                if (param.mode == Mode::Value)
                    throw std::runtime_error("ownership violation: by-value class parameter '" +
                        param.name + "' requires exclusive borrow or proven move/drop lowering");
            }
            LocalOwnership entry;
            entry.mode = param.mode;
            // Native by-value scalar parameters occupy independently owned,
            // mutable stack slots; borrowed parameters retain caller loans.
            // Do not silently confer that mutability on const local bindings.
            entry.mutable_owner = param.mode == Mode::Value;
            entry.class_name = param.class_name;
            if (!param.class_name.empty()) entry.class_fields = class_fields.at(param.class_name);
            locals.emplace(param.name, std::move(entry));
        }
        for (const auto& binding : function.locals) {
            LocalOwnership entry;
            entry.heap_owned = binding.heap_owned;
            entry.mutable_owner = binding.owner_mutable;
            entry.class_name = binding.class_name;
            if (binding.new_class) {
                entry.class_fields = class_fields.at(binding.class_name);
            } else if (binding.move_class) {
                const auto found = locals.find(binding.move_source);
                if (found == locals.end() || found->second.class_name != binding.class_name)
                    throw std::runtime_error("ownership violation: class move type mismatch at byte " +
                        std::to_string(binding.offset));
                auto& source = found->second;
                if (source.mode != Mode::Value || source.moved ||
                        source.exclusive_loan || source.shared_loans != 0 ||
                        !source.moved_fields.empty())
                    throw std::runtime_error("ownership violation: class move requires live unborrowed owner at byte " +
                        std::to_string(binding.offset));
                entry.class_fields = source.class_fields;
                source.moved = true;
            } else {
                check_value(*binding.initializer, locals, functions);
            }
            locals.emplace(binding.name, std::move(entry));
        }
        std::vector<const Statement*> deferred_effects;
        auto check_effect = [&](const Statement& stmt, Locals& state) {
            if (stmt.kind == Statement::Kind::ScopedLocal) {
                const LocalBinding& local = *stmt.branch_local;
                if (state.count(local.name))
                    throw std::runtime_error("ownership violation: branch local shadows live owner at byte " +
                        std::to_string(local.offset));
                check_value(*local.initializer, state, functions);
                state.emplace(local.name, LocalOwnership{});
                return;
            }
            if (stmt.kind == Statement::Kind::FieldWrite) {
                auto& recv = checked_field(stmt.receiver, stmt.field, stmt.offset, state);
                if (recv.mode == Mode::Borrow)
                    throw std::runtime_error("ownership violation: cannot mutate through shared class borrow");
                if (recv.mode == Mode::Value && !recv.mutable_owner)
                    throw std::runtime_error("ownership violation: class mutation requires let mut owner");
                if (recv.exclusive_loan || recv.shared_loans != 0)
                    throw std::runtime_error("ownership violation: class field write conflicts with active borrow");
                check_value(*stmt.expression, state, functions);
                recv.moved_fields.erase(stmt.field);
            } else if (stmt.kind == Statement::Kind::Call) {
                if (stmt.expression->kind != Expression::Kind::Call)
                    throw std::runtime_error("invalid native call statement");
                check_call(*stmt.expression, state, functions);
            } else {
                throw std::runtime_error("ownership violation: unsupported conditional arm effect");
            }
        };
        for (const auto& stmt : function.statements) {
            if (stmt.kind == Statement::Kind::Defer) {
                deferred_effects.push_back(&stmt);
                continue;
            }
            if (stmt.kind == Statement::Kind::Conditional) {
                // A condition cannot change ownership; analyze each arm
                // independently and require compatible resulting states.
                // Until phi ownership/drop flags exist, the checker must
                // reject divergent moves instead of silently picking a path.
                check_pure_guard(*stmt.condition_lhs, locals, functions);
                check_pure_guard(*stmt.condition_rhs, locals, functions);
                Locals then_state = locals;
                Locals else_state = locals;
                for (const auto& arm : stmt.then_statements)
                    check_effect(arm, then_state);
                for (const auto& arm : stmt.else_statements)
                    check_effect(arm, else_state);
                // Scoped i64 locals have complete lexical lifetime in their
                // own arm; they may not influence the predecessor join or
                // be observable on later exit cleanup paths.
                for (const auto& arm : stmt.then_statements)
                    if (arm.kind == Statement::Kind::ScopedLocal)
                        then_state.erase(arm.branch_local->name);
                for (const auto& arm : stmt.else_statements)
                    if (arm.kind == Statement::Kind::ScopedLocal)
                        else_state.erase(arm.branch_local->name);
                for (const auto& item : then_state) {
                    const auto found = else_state.find(item.first);
                    if (found == else_state.end() ||
                            item.second.moved != found->second.moved ||
                            item.second.moved_fields != found->second.moved_fields ||
                            item.second.shared_loans != found->second.shared_loans ||
                            item.second.exclusive_loan != found->second.exclusive_loan)
                        throw std::runtime_error("ownership violation: conditional CFG predecessor ownership mismatch at byte " +
                            std::to_string(stmt.offset));
                }
                locals = std::move(then_state);
                continue;
            }
            check_effect(stmt, locals);
        }
        // Actor sends transfer scalar payloads in lexical send/stop order.
        // Do not let the backend load moved locals or leak raw borrow pointers.
        for (const auto& action : function.actor_actions) {
            if (action.kind == ActorAction::Kind::Send) {
                const auto& send = function.actor_sends.at(action.index);
                check_value(*send.payload, locals, functions);
            }
        }
        auto check_deferred_exit = [&](Locals& path) {
            for (auto it = deferred_effects.rbegin(); it != deferred_effects.rend(); ++it) {
                const Statement& cleanup = **it;
                if (cleanup.receiver.empty()) {
                    check_call(*cleanup.expression, path, functions);
                    continue;
                }
                auto& recv = checked_field(cleanup.receiver, cleanup.field,
                                           cleanup.offset, path);
                if (recv.mode == Mode::Borrow)
                    throw std::runtime_error("ownership violation: cannot mutate through shared class borrow");
                if (recv.mode == Mode::Value && !recv.mutable_owner)
                    throw std::runtime_error("ownership violation: class mutation requires let mut owner");
                if (recv.exclusive_loan || recv.shared_loans != 0)
                    throw std::runtime_error("ownership violation: class field write conflicts with active borrow");
                check_value(*cleanup.expression, path, functions);
                recv.moved_fields.erase(cleanup.field);
            }
        };
        const Locals cfg_entry = locals;
        // Analyze each taken return independently. Even an explicit scalar
        // rt take in one return branch does not move that value in the
        // fallthrough path, which has a different live ownership state.
        for (const auto& guard : function.early_returns) {
            check_pure_guard(*guard.lhs, locals, functions);
            check_pure_guard(*guard.rhs, locals, functions);
            Locals taken = locals;
            check_value(*guard.result, taken, functions);
            check_deferred_exit(taken);
        }
        if (function.result) check_value(*function.result, locals, functions);
        check_deferred_exit(locals);
        // Build the real guarded-return edge graph and run the reusable
        // field-sensitive fixed-point verifier. This currently models the
        // admitted return-only source CFG. The lattice also handles general
        // diamonds and loops (tested separately), but does not admit new
        // branch-local constructors, exceptional edges or suspension yet.
        ownership::Graph cfg;
        for (const auto& item : cfg_entry) {
            const auto& name = item.first;
            const auto& owner = item.second;
            ownership::PlaceState state;
            state.possible = owner.moved ? ownership::kMoved : ownership::kOwned;
            state.shared_loans = static_cast<unsigned>(owner.shared_loans);
            state.exclusive_loan = owner.exclusive_loan;
            if (owner.class_name.empty()) {
                cfg.entry.emplace(name, state);
            } else {
                for (const auto& field : owner.class_fields) {
                    auto field_state = state;
                    if (owner.moved_fields.count(field))
                        field_state.possible = ownership::kMoved;
                    cfg.entry.emplace(name + "." + field, field_state);
                }
            }
        }
        using OpKind = ownership::Operation::Kind;
        using Ops = std::vector<ownership::Operation>;
        std::function<void(const Expression&, Ops&)> add_effects;
        add_effects = [&](const Expression& expr, Ops& operations) {
            if (expr.kind == Expression::Kind::Variable) {
                const auto found = cfg_entry.find(expr.name);
                const bool object = found != cfg_entry.end() && !found->second.class_name.empty();
                operations.push_back({object ? OpKind::ReadObject : OpKind::Read, expr.name});
                return;
            }
            if (expr.kind == Expression::Kind::Field) {
                if (!expr.left || expr.left->kind != Expression::Kind::Variable)
                    reject(expr, "native CFG requires named field receiver");
                operations.push_back({OpKind::Read, expr.left->name + "." + expr.name});
                return;
            }
            if (expr.kind == Expression::Kind::Take && expr.left) {
                if (expr.left->kind == Expression::Kind::Variable) {
                    operations.push_back({OpKind::Move, expr.left->name});
                    return;
                }
                if (expr.left->kind == Expression::Kind::Field) {
                    if (!expr.left->left ||
                            expr.left->left->kind != Expression::Kind::Variable)
                        reject(expr, "native CFG requires named class field take");
                    operations.push_back({OpKind::Move,
                        expr.left->left->name + "." + expr.left->name});
                    return;
                }
            }
            if (expr.left) add_effects(*expr.left, operations);
            if (expr.right) add_effects(*expr.right, operations);
            for (const auto& argument : expr.arguments)
                add_effects(*argument, operations);
        };
        auto add_cleanup_effects = [&](const Statement& cleanup, Ops& operations) {
            if (!cleanup.receiver.empty())
                operations.push_back({OpKind::Read, cleanup.receiver + "." + cleanup.field});
            add_effects(*cleanup.expression, operations);
        };
        const std::size_t guard_count = function.early_returns.size();
        cfg.blocks.resize(guard_count * 2 + 1);
        for (std::size_t i = 0; i < guard_count; ++i) {
            const auto& guard = function.early_returns[i];
            auto& condition = cfg.blocks[2 * i];
            add_effects(*guard.lhs, condition.operations);
            add_effects(*guard.rhs, condition.operations);
            condition.successors = {2 * i + 1, 2 * i + 2};
            add_effects(*guard.result, cfg.blocks[2 * i + 1].operations);
            // Preserve deferred call inputs after each early-return value.
            for (auto it = deferred_effects.rbegin(); it != deferred_effects.rend(); ++it)
                add_cleanup_effects(**it, cfg.blocks[2 * i + 1].operations);
        }
        if (function.result)
            add_effects(*function.result, cfg.blocks[guard_count * 2].operations);
        for (auto it = deferred_effects.rbegin(); it != deferred_effects.rend(); ++it)
            add_cleanup_effects(**it, cfg.blocks[guard_count * 2].operations);
        // Every reachable terminal CFG path must end with an explicit
        // conditional drop of the experimental heap-owned places. The
        // emitter backs each DropIfOwned with a runtime live flag; scalar
        // stack locals and trivially destructible class fields need none.
        for (auto& block : cfg.blocks)
            if (block.successors.empty())
                for (const auto& entry : cfg_entry)
                    if (entry.second.heap_owned)
                        block.operations.push_back({OpKind::DropIfOwned, entry.first});
        ownership::verify(cfg);

    }
}

} // namespace oreslang

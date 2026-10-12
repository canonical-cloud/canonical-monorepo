#include "oreslang/frontend/Parser.hpp"
#include "oreslang/types/OwnershipChecker.hpp"

#include <algorithm>
#include <charconv>
#include <functional>
#include <cctype>
#include <stdexcept>
#include <string>
#include <string_view>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace oreslang {
namespace {

enum class Kind { Identifier, Integer, Symbol, End };
struct Token {
    Kind kind;
    std::string_view text;
    std::size_t offset;
};

bool exceptional_control(std::string_view word) {
    return word == "throw" || word == "raise" || word == "panic" ||
           word == "recover" || word == "defer" || word == "try" ||
           word == "catch" || word == "finally" || word == "trap";
}

bool digit(char ch) { return ch >= '0' && ch <= '9'; }
bool identifier_start(char ch) {
    return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch == '_';
}
bool identifier_part(char ch) { return identifier_start(ch) || digit(ch); }

bool reserved(std::string_view name) {
    // Keep these reserved even while their grammar is unsupported.
    static constexpr std::string_view words[] = {
        "define", "class", "module", "contract", "conforms", "namespace",
        "import", "from", "as", "extends", "implements", "try", "catch",
        "finally", "end", "fi", "if", "do", "else", "then", "new",
        "spawn", "stop", "done", "await", "rt", "async", "suspends", "suspend", "critical", "generator",
        "nlex", "trap", "actor", "isoactor", "def", "fnc", "routine",
        "for", "of", "loop", "block", "break", "continue", "yield",
        "super", "elseif", "elif", "switch", "match", "matches", "is",
        "default", "eq", "neq", "nb", "select", "readch", "writech",
        "cb", "shared", "untrusted", "type", "types", "typeof",
        "interface", "trait", "struct", "impl", "abstract", "void",
        "static", "pub", "private", "return", "defer", "throw", "raise",
        "panic", "recover", "val", "const",
        "let", "mut", "borrow", "self", "true", "false", "null", "obj", "arr",
        "gpu", "quantum", "over", "structural", "int"
    };
    return std::find(std::begin(words), std::end(words), name) != std::end(words);
}

class Lexer {
public:
    explicit Lexer(std::string_view source) : source_(source) {}

    Token next() {
        for (;;) {
            if (at_ == source_.size()) return {Kind::End, {}, at_};
            const unsigned char ch = static_cast<unsigned char>(source_[at_]);
            if (std::isspace(ch)) { ++at_; continue; }
            if (source_.substr(at_, 2) == "//") {
                const auto end = source_.find('\n', at_ + 2);
                at_ = end == std::string_view::npos ? source_.size() : end;
                continue;
            }
            if (source_.substr(at_, 2) == "/*") {
                const auto start = at_;
                at_ += 2;
                std::size_t depth = 1;
                while (depth != 0) {
                    if (at_ == source_.size()) {
                        throw std::runtime_error("unterminated block comment at byte "
                                                 + std::to_string(start));
                    }
                    if (source_.substr(at_, 2) == "/*") { at_ += 2; ++depth; }
                    else if (source_.substr(at_, 2) == "*/") { at_ += 2; --depth; }
                    else ++at_;
                }
                continue;
            }
            break;
        }
        const std::size_t start = at_;
        const char ch = source_[at_];
        if (identifier_start(ch)) {
            ++at_;
            while (at_ < source_.size() && identifier_part(source_[at_])) ++at_;
            return {Kind::Identifier, source_.substr(start, at_ - start), start};
        }
        if (digit(ch)) {
            ++at_;
            while (at_ < source_.size() && (digit(source_[at_]) || source_[at_] == '_')) {
                ++at_;
            }
            return {Kind::Integer, source_.substr(start, at_ - start), start};
        }
        // Contiguous '==' is one token, matching the Java/Graal lexer.
        if (source_.substr(at_, 2) == "==") {
            at_ += 2;
            return {Kind::Symbol, source_.substr(start, 2), start};
        }
        if (std::string_view("(){},:;+-*=.<>").find(ch) != std::string_view::npos) {
            ++at_;
            return {Kind::Symbol, source_.substr(start, 1), start};
        }
        throw std::runtime_error("unsupported Oreslang token at byte "
                                 + std::to_string(start));
    }

private:
    std::string_view source_;
    std::size_t at_ = 0;
};

std::unique_ptr<Expression> make_expression(Expression::Kind kind,
                                             std::size_t offset) {
    auto result = std::make_unique<Expression>();
    result->kind = kind;
    result->offset = offset;
    return result;
}

class Parser {
public:
    explicit Parser(std::string_view source, bool experimental_owned_int)
        : lexer_(source), token_(lexer_.next()),
          experimental_owned_int_(experimental_owned_int) {}

    Program parse() {
        Program program;
        bool wrapped_module = false;
        if (accept("define")) {
            if (accept("module")) {
                program.module = identifier();
                accept("as");
                wrapped_module = true;
            } else {
                if (accept("class")) program.classes.push_back(class_declaration());
                else if (accept("actor")) program.actors.push_back(actor_declaration());
                else fail("expected 'module', 'class' or 'actor'");
            }
        }
        while (token_.kind != Kind::End
                && !(wrapped_module && token_.text == "end")) {
            if (accept("define")) {
                if (accept("class")) program.classes.push_back(class_declaration());
                else if (accept("actor")) program.actors.push_back(actor_declaration());
                else fail("expected 'class' or 'actor'");
            } else {
                program.functions.push_back(function());
            }
        }
        if (wrapped_module) require("end");
        if (token_.kind != Kind::End) fail("unexpected trailing source");
        if (program.functions.empty() && program.actors.empty()) fail("expected at least one function or actor");
        validate(program);
        return program;
    }

private:
    ActorDecl actor_declaration() {
        ActorDecl actor;
        actor.offset = token_.offset;
        actor.name = identifier();
        require("as");
        const bool braced = accept("{");
        std::unordered_set<std::string> names;
        while (token_.text == "let" || token_.text == "const" || token_.text == "val") {
            if (actor.fields.size() == 16) fail("native actor field limit exceeded (16)");
            LocalBinding field;
            field.offset = token_.offset;
            field.field_mutable = token_.text == "let";
            advance();
            field.name = identifier();
            if (!names.insert(field.name).second) fail("duplicate actor field '" + field.name + "'");
            require(":");
            require("int");
            require("=");
            field.initializer = expression();
            require(";");
            actor.fields.push_back(std::move(field));
        }
        if (actor.fields.empty()) fail("actor requires at least one scalar field");
        Function method;
        method.offset = token_.offset;
        method.exported = accept("pub");
        if (!method.exported) fail("native actor requires pub on_message(int)");
        require("fnc");
        method.name = identifier();
        if (method.name != "on_message") fail("native actor supports only on_message");
        require("(");
        require("int");
        Parameter param;
        param.name = identifier();
        method.parameters.push_back(std::move(param));
        require(")");
        require(":");
        require("int");
        require("{");
        while (token_.text != "return") {
            if (token_.kind == Kind::End || token_.text == "}") fail("actor handler requires return");
            ActorFieldWrite write;
            write.offset = token_.offset;
            write.field = identifier();
            require("=");
            write.expression = expression();
            require(";");
            method.actor_field_writes.push_back(std::move(write));
        }
        require("return");
        method.result = expression();
        require(";");
        require("}");
        actor.on_message = std::move(method);
        if (braced) require("}");
        else require("end");
        return actor;
    }

    ClassDecl class_declaration() {
        ClassDecl result;
        result.name = identifier();
        require("as");
        std::unordered_set<std::string> seen;
        // Only plain, ordered i64 fields are admitted: no nested objects,
        // pointers, destructors, user initializers or implicit heap storage.
        while (token_.text != "end") {
            if (token_.kind == Kind::End) fail("expected 'end'");
            if (result.fields.size() == 16)
                fail("native class field limit exceeded (16)");
            accept("pub");
            require("let");
            require("int");
            ClassField field;
            field.name = identifier();
            if (!seen.insert(field.name).second)
                fail("duplicate class field '" + field.name + "'");
            require("=");
            if (token_.kind != Kind::Integer)
                fail("class field requires i64 literal initializer");
            field.initial = integer_literal();
            require(";");
            result.fields.push_back(std::move(field));
        }
        if (result.fields.empty()) fail("native class requires at least one i64 field");
        require("end");
        return result;
    }

    std::int64_t integer_literal() {
        if (token_.kind != Kind::Integer) fail("expected integer literal");
        std::string digits(token_.text);
        if (digits.front() == '_' || digits.back() == '_' ||
                digits.find("__") != std::string::npos) fail("malformed integer separator");
        digits.erase(std::remove(digits.begin(), digits.end(), '_'), digits.end());
        std::int64_t value = 0;
        const auto parsed = std::from_chars(digits.data(), digits.data() + digits.size(), value);
        if (parsed.ec != std::errc{} || parsed.ptr != digits.data() + digits.size())
            fail("integer literal overflows signed 64-bit result");
        advance();
        return value;
    }

    Function function() {
        Function value;
        value.offset = token_.offset;
        value.exported = accept("pub");
        if (exceptional_control(token_.text))
            fail("native exception/control effect unsupported");
        if (token_.text == "gpu" || token_.text == "quantum") {
            fail("native accelerator lowering unsupported");
        }
        if (token_.text == "suspends" || token_.text == "suspend") {
            fail("native suspends declaration requires suspension-aware borrow checking and LLVM continuation lowering");
        }
        if (token_.text == "critical") {
            fail("native critical declaration requires compiler lowering and scheduler-owned logical critical tickets");
        }
        if (token_.text == "actor" || token_.text == "async" ||
            token_.text == "generator" || token_.text == "isoactor") {
            fail("native actor/async declaration requires actor frames, suspension-aware borrow checking and LLVM lowering");
        }
        if (!accept("fnc") && !accept("routine")) fail("expected fnc or routine");
        value.name = identifier();
        require("(");
        if (!accept(")")) {
            do {
                Parameter parameter;
                if (accept("borrow")) {
                    parameter.mode = accept("mut") ? Parameter::Mode::BorrowMut
                                                    : Parameter::Mode::Borrow;
                }
                if (!accept("int")) parameter.class_name = identifier();
                parameter.name = identifier();
                value.parameters.push_back(std::move(parameter));
            } while (accept(","));
            require(")");
        }
        require(":");
        value.returns_void = accept("void");
        if (!value.returns_void) require("int");
        require("{");
        while (token_.text == "const" || token_.text == "val" || token_.text == "let") {
            LocalBinding binding;
            binding.offset = token_.offset;
            if (accept("let")) {
                // Preserve the Java/Graal distinction between immutable
                // let Class and exclusively borrowable let mut Class.
                binding.owner_mutable = accept("mut");
                // Class construction is stack-only. No reference to an
                // uninitialized, moved, or temporary class can escape.
                binding.class_name = identifier();
                binding.name = identifier();
                require("=");
                if (accept("new")) {
                    const std::string ctor = identifier();
                    if (ctor != binding.class_name) fail("class constructor type mismatch");
                    require("(");
                    require(")");
                    binding.new_class = true;
                } else {
                    require("rt");
                    require("take");
                    const bool parenthesized = accept("(");
                    binding.move_source = identifier();
                    if (parenthesized) require(")");
                    binding.move_class = true;
                }
            } else {
                // A val owns mutable scalar storage; const permits only shared
                // loans. Preserve the distinction for native ownership checks.
                binding.owner_mutable = token_.text == "val";
                advance();
                binding.name = identifier();
                // Distinguish actor capabilities from scalar data before IR.
                // Unsupported generic futures never become fake blocking calls.
                if (token_.text != ":" && token_.text != "=") require(":");
                const bool explicit_type = accept(":");
                SourceType declared_type;
                bool typed_actor_ref = false;
                if (explicit_type) {
                    if (accept("ActorRef")) {
                        require("<");
                        declared_type.kind = SourceType::Kind::ActorRef;
                        declared_type.argument = identifier();
                        require(">");
                        typed_actor_ref = true;
                    } else if (accept("Future")) {
                        require("<");
                        declared_type.kind = SourceType::Kind::Future;
                        if (accept("int")) declared_type.argument = "int";
                        else declared_type.argument = identifier();
                        require(">");
                        fail("Future<T> requires native continuation lowering");
                    } else {
                        if (token_.text == "owned" && !experimental_owned_int_)
                            fail("experimental owned int requires --experimental-owned-int");
                        binding.heap_owned = experimental_owned_int_ && accept("owned");
                        require("int");
                    }
                }
                require("=");
                if (accept("spawn")) {
                    if (explicit_type && !typed_actor_ref)
                        fail("spawn initializer requires ActorRef<T> type or inference");
                    ActorSpawnBinding spawned;
                    spawned.name = binding.name;
                    spawned.offset = binding.offset;
                    spawned.actor_type = identifier();
                    spawned.declared_type.kind = SourceType::Kind::ActorRef;
                    spawned.declared_type.argument =
                        typed_actor_ref ? declared_type.argument : spawned.actor_type;
                    if (spawned.declared_type.argument != spawned.actor_type)
                        fail("ActorRef<T> type mismatch with spawned actor");
                    require("(");
                    require(")");
                    require(";");
                    value.actor_spawns.push_back(std::move(spawned));
                    continue;
                }
                if (typed_actor_ref) fail("ActorRef<T> requires spawn initializer");
                if (!explicit_type) fail("scalar local requires ': int'");
                binding.initializer = expression();
            }
            require(";");
            value.locals.push_back(std::move(binding));
        }
        // Restrict the first general-source CFG slice to synchronous
        // if/else arms containing field writes or direct function calls.
        // They may change owned scalar state only when both predecessors
        // agree at the join; checked below by the ownership verifier.
        auto branch_arm = [&]() {
            std::vector<Statement> actions;
            while (token_.text != "}") {
                if (token_.kind == Kind::End || actions.size() == 16)
                    fail("native conditional arm limit exceeded (16)");
                Statement statement;
                statement.offset = token_.offset;
                if (token_.text == "let")
                    fail("native branch-local class owner requires destructor/drop lowering");
                if (accept("const") || accept("val")) {
                    statement.kind = Statement::Kind::ScopedLocal;
                    statement.branch_local = std::make_unique<LocalBinding>();
                    statement.branch_local->offset = statement.offset;
                    statement.branch_local->name = identifier();
                    require(":");
                    require("int");
                    require("=");
                    statement.branch_local->initializer = expression();
                    require(";");
                    actions.push_back(std::move(statement));
                    continue;
                }
                auto target = primary();
                if (target->kind == Expression::Kind::Field && accept("=")) {
                    if (!target->left || target->left->kind != Expression::Kind::Variable)
                        fail("native conditional requires named class field");
                    statement.kind = Statement::Kind::FieldWrite;
                    statement.receiver = target->left->name;
                    statement.field = target->name;
                    statement.expression = expression();
                } else if (target->kind == Expression::Kind::Call) {
                    statement.kind = Statement::Kind::Call;
                    statement.expression = std::move(target);
                } else {
                    fail("native conditional arm requires field assignment or direct call");
                }
                require(";");
                actions.push_back(std::move(statement));
            }
            return actions;
        };
        bool return_guards_started = false;
        std::size_t branch_count = 0;
        while (token_.text != "return") {
            if (token_.kind == Kind::End || token_.text == "}") {
                if (return_guards_started) fail("expected 'return'");
                fail("missing final return");
            }
            if (token_.text == "if") {
                const auto offset = token_.offset;
                require("if");
                require("(");
                auto lhs = expression();
                if (!accept("eq")) require("==");
                auto rhs = expression();
                require(")");
                require("{");
                if (accept("return")) {
                    if (value.returns_void)
                        fail("guarded early return requires int result");
                    if (value.early_returns.size() == 8)
                        fail("native guarded return limit exceeded (8)");
                    GuardedReturn guard;
                    guard.offset = offset;
                    guard.lhs = std::move(lhs);
                    guard.rhs = std::move(rhs);
                    guard.result = expression();
                    require(";");
                    require("}");
                    require("fi");
                    value.early_returns.push_back(std::move(guard));
                    return_guards_started = true;
                } else {
                    if (return_guards_started)
                        fail("native conditional statements cannot follow return guards");
                    if (++branch_count > 8)
                        fail("native conditional CFG limit exceeded (8)");
                    Statement conditional;
                    conditional.kind = Statement::Kind::Conditional;
                    conditional.offset = offset;
                    conditional.condition_lhs = std::move(lhs);
                    conditional.condition_rhs = std::move(rhs);
                    conditional.then_statements = branch_arm();
                    require("}");
                    require("else");
                    require("{");
                    conditional.else_statements = branch_arm();
                    require("}");
                    require("fi");
                    value.statements.push_back(std::move(conditional));
                }
                continue;
            }
            if (return_guards_started)
                fail("native statements cannot follow guarded returns");
            if (token_.text != "defer" && exceptional_control(token_.text))
                fail("native exception/control effect unsupported");
            if (accept("defer")) {
                Statement deferred;
                deferred.kind = Statement::Kind::Defer;
                deferred.offset = token_.offset;
                auto target = primary();
                if (target->kind == Expression::Kind::Field && accept("=")) {
                    if (!target->left || target->left->kind != Expression::Kind::Variable)
                        fail("native deferred field assignment requires named class receiver");
                    deferred.receiver = target->left->name;
                    deferred.field = target->name;
                    deferred.expression = expression();
                } else if (target->kind == Expression::Kind::Call) {
                    deferred.expression = std::move(target);
                } else {
                    fail("native defer requires a direct function call or class field assignment");
                }
                require(";");
                value.statements.push_back(std::move(deferred));
                continue;
            }
            if (accept("stop")) {
                value.actor_stops.push_back(identifier());
                require(";");
                value.actor_actions.push_back({ActorAction::Kind::Stop,
                                               value.actor_stops.size() - 1});
                continue;
            }
            Statement statement;
            statement.offset = token_.offset;
            auto action = primary();
            if (action->kind == Expression::Kind::Field && action->name == "send"
                    && accept("(")) {
                ActorSend send;
                send.offset = statement.offset;
                send.reference = action->left->name;
                send.payload = expression();
                require(")");
                require(";");
                value.actor_sends.push_back(std::move(send));
                value.actor_actions.push_back({ActorAction::Kind::Send,
                                               value.actor_sends.size() - 1});
                continue;
            }
            if (action->kind == Expression::Kind::Field && accept("=")) {
                statement.kind = Statement::Kind::FieldWrite;
                statement.receiver = action->left->name;
                statement.field = action->name;
                statement.expression = expression();
            } else if (action->kind == Expression::Kind::Call) {
                statement.kind = Statement::Kind::Call;
                statement.expression = std::move(action);
            } else {
                fail("expected class field assignment or function call statement");
            }
            require(";");
            value.statements.push_back(std::move(statement));
        }
        require("return");
        if (!value.returns_void) value.result = expression();
        require(";");
        require("}");
        return value;
    }

    std::unique_ptr<Expression> expression() { return additive(); }

    std::unique_ptr<Expression> additive() {
        auto left = product();
        while (token_.text == "+" || token_.text == "-") {
            const auto offset = token_.offset;
            const auto op = token_.text;
            advance();
            auto expr = make_expression(op == "+" ? Expression::Kind::Add
                                                 : Expression::Kind::Subtract, offset);
            expr->left = std::move(left);
            expr->right = product();
            left = std::move(expr);
        }
        return left;
    }

    std::unique_ptr<Expression> product() {
        auto left = unary();
        while (token_.text == "*") {
            const auto offset = token_.offset;
            advance();
            auto expr = make_expression(Expression::Kind::Multiply, offset);
            expr->left = std::move(left);
            expr->right = unary();
            left = std::move(expr);
        }
        return left;
    }

    std::unique_ptr<Expression> unary() {
        if (token_.text == "rt") {
            const auto offset = token_.offset;
            advance();
            const auto operation = token_.text;
            if (operation != "borrow" && operation != "copy" &&
                operation != "take" && operation != "share") {
                fail("unsupported native rt operation; suspension/ownership lowering is unavailable");
            }
            advance();
            const bool mutable_borrow = operation == "borrow" && accept("mut");
            auto result = make_expression(
                operation == "copy" ? Expression::Kind::Copy :
                operation == "take" ? Expression::Kind::Take :
                operation == "share" ? Expression::Kind::Share :
                mutable_borrow ? Expression::Kind::BorrowMut : Expression::Kind::Borrow,
                offset);
            if (accept("(")) {
                result->left = expression();
                require(")");
            } else {
                result->left = unary();
            }
            return result;
        }
        if (token_.text == "-") {
            const auto offset = token_.offset;
            advance();
            auto expr = make_expression(Expression::Kind::Negate, offset);
            expr->left = unary();
            return expr;
        }
        return primary();
    }

    std::unique_ptr<Expression> primary() {
        const auto offset = token_.offset;
        if (accept("(")) {
            auto inner = expression();
            require(")");
            return inner;
        }
        if (token_.kind == Kind::Integer) {
            auto expr = make_expression(Expression::Kind::Integer, offset);
            expr->integer = integer_literal();
            return expr;
        }
        if (token_.kind != Kind::Identifier || reserved(token_.text)) {
            fail("expected int expression");
        }
        auto expr = make_expression(Expression::Kind::Variable, offset);
        expr->name = identifier();
        if (accept("(")) {
            expr->kind = Expression::Kind::Call;
            if (!accept(")")) {
                do {
                    expr->arguments.push_back(expression());
                } while (accept(","));
                require(")");
            }
        } else if (accept(".")) {
            auto field = make_expression(Expression::Kind::Field, offset);
            field->left = std::move(expr);
            field->name = identifier();
            expr = std::move(field);
        }
        return expr;
    }

    bool accept(std::string_view text) {
        if (token_.text != text) return false;
        advance();
        return true;
    }

    void require(std::string_view text) {
        if (!accept(text)) fail("expected '" + std::string(text) + "'");
    }

    std::string identifier() {
        if (token_.kind != Kind::Identifier || reserved(token_.text)) {
            fail("expected non-keyword identifier");
        }
        std::string result(token_.text);
        advance();
        return result;
    }

    static void validate_expression(const Expression& expr,
                                    const std::unordered_set<std::string>& parameters,
                                    const std::unordered_map<std::string, std::size_t>& functions) {
        switch (expr.kind) {
            case Expression::Kind::Integer: return;
            case Expression::Kind::Variable:
                if (parameters.count(expr.name) == 0) {
                    throw std::runtime_error("unknown parameter '" + expr.name
                                             + "' at byte " + std::to_string(expr.offset));
                }
                return;
            case Expression::Kind::Field:
                validate_expression(*expr.left, parameters, functions);
                return;
            case Expression::Kind::Call: {
                const auto found = functions.find(expr.name);
                if (found == functions.end() || found->second != expr.arguments.size()) {
                    throw std::runtime_error("unknown function or wrong call arity '"
                                             + expr.name + "' at byte "
                                             + std::to_string(expr.offset));
                }
                for (const auto& arg : expr.arguments) {
                    validate_expression(*arg, parameters, functions);
                }
                return;
            }
            case Expression::Kind::Negate:
            case Expression::Kind::Copy:
            case Expression::Kind::Take:
            case Expression::Kind::Share:
            case Expression::Kind::Borrow:
            case Expression::Kind::BorrowMut:
                validate_expression(*expr.left, parameters, functions);
                return;
            case Expression::Kind::Add:
            case Expression::Kind::Subtract:
            case Expression::Kind::Multiply:
                validate_expression(*expr.left, parameters, functions);
                validate_expression(*expr.right, parameters, functions);
                return;
        }
        throw std::runtime_error("internal invalid expression kind");
    }

    static void validate(const Program& program) {
        std::unordered_set<std::string> classes;
        for (const auto& cls : program.classes) {
            if (!classes.insert(cls.name).second)
                throw std::runtime_error("duplicate class declaration '" + cls.name + "'");
        }
        std::unordered_map<std::string, std::size_t> functions;
        for (const auto& fn : program.functions) {
            if (!functions.emplace(fn.name, fn.parameters.size()).second) {
                throw std::runtime_error("duplicate function '" + fn.name + "' at byte "
                                         + std::to_string(fn.offset));
            }
            std::unordered_set<std::string> params;
            for (const auto& param : fn.parameters) {
                if (!params.insert(param.name).second) {
                    throw std::runtime_error("duplicate parameter '" + param.name
                                             + "' at byte " + std::to_string(fn.offset));
                }
            }
        }
        std::unordered_map<std::string, const ActorDecl*> actor_types;
        for (const auto& actor : program.actors) {
            if (!actor_types.emplace(actor.name, &actor).second || classes.count(actor.name)
                    || functions.count(actor.name))
                throw std::runtime_error("duplicate actor/class/function symbol '" + actor.name + "'");
            std::unordered_set<std::string> fields;
            std::unordered_set<std::string> mutables;
            const std::unordered_set<std::string> empty;
            for (const auto& field : actor.fields) {
                validate_expression(*field.initializer, empty, {});
                if (!fields.insert(field.name).second)
                    throw std::runtime_error("duplicate actor field '" + field.name + "'");
                if (field.field_mutable) mutables.insert(field.name);
            }
            const auto& method = actor.on_message;
            const std::string& parameter = method.parameters.at(0).name;
            if (!fields.insert(parameter).second)
                throw std::runtime_error("actor parameter shadows field '" + parameter + "'");
            for (const auto& write : method.actor_field_writes) {
                if (!mutables.count(write.field))
                    throw std::runtime_error("cannot assign immutable or unknown actor field '" + write.field + "'");
                validate_expression(*write.expression, fields, functions);
            }
            validate_expression(*method.result, fields, functions);
            if (functions.count("oreslang_actor_" + actor.name + "_init") ||
                    functions.count("oreslang_actor_" + actor.name + "_on_message"))
                throw std::runtime_error("conflicting generated actor symbol");
        }
        for (const auto& fn : program.functions) {
            std::unordered_set<std::string> params;
            for (const auto& param : fn.parameters) params.insert(param.name);
            std::unordered_set<std::string> live_actors;
            std::unordered_map<std::string, const ActorDecl*> references;
            if (!fn.actor_spawns.empty() || !fn.actor_sends.empty() || !fn.actor_stops.empty()) {
                if (fn.name != "main" || !fn.parameters.empty() || fn.returns_void ||
                        !fn.early_returns.empty() || !fn.statements.empty())
                    throw std::runtime_error("source actor bootstrap requires zero-argument int main without early returns");
            }
            for (const auto& spawn : fn.actor_spawns) {
                const auto it = actor_types.find(spawn.actor_type);
                if (it == actor_types.end())
                    throw std::runtime_error("unknown actor type '" + spawn.actor_type + "'");
                if (!live_actors.insert(spawn.name).second || params.count(spawn.name))
                    throw std::runtime_error("duplicate actor reference '" + spawn.name + "'");
                references.emplace(spawn.name, it->second);
            }
            for (const auto& binding : fn.locals) {
                // Validate before publishing the name: reject self/forward reads.
                if (binding.new_class || binding.move_class) {
                    if (classes.count(binding.class_name) == 0)
                        throw std::runtime_error("unknown class '" + binding.class_name + "'");
                    if (binding.move_class && !params.count(binding.move_source))
                        throw std::runtime_error("unknown class move source '" + binding.move_source + "'");
                } else {
                    validate_expression(*binding.initializer, params, functions);
                }
                if (live_actors.count(binding.name))
                    throw std::runtime_error("scalar local shadows actor reference '" + binding.name + "'");
                if (!params.insert(binding.name).second) {
                    throw std::runtime_error("duplicate owned local '" + binding.name
                        + "' at byte " + std::to_string(binding.offset));
                }
            }
            using NameSet = std::unordered_set<std::string>;
            std::function<void(const Statement&, NameSet&)> check_statement_names;
            check_statement_names = [&](const Statement& stmt, NameSet& names) {
                if (stmt.kind == Statement::Kind::Conditional) {
                    validate_expression(*stmt.condition_lhs, names, functions);
                    validate_expression(*stmt.condition_rhs, names, functions);
                    NameSet then_names = names;
                    NameSet else_names = names;
                    for (const auto& action : stmt.then_statements)
                        check_statement_names(action, then_names);
                    for (const auto& action : stmt.else_statements)
                        check_statement_names(action, else_names);
                    // Neither arm's lexical locals escape into the parent scope.
                    return;
                }
                if (stmt.kind == Statement::Kind::ScopedLocal) {
                    const LocalBinding& local = *stmt.branch_local;
                    validate_expression(*local.initializer, names, functions);
                    if (!names.insert(local.name).second)
                        throw std::runtime_error("duplicate branch-local name '" +
                            local.name + "' at byte " + std::to_string(local.offset));
                    return;
                }
                if ((stmt.kind == Statement::Kind::FieldWrite ||
                        (stmt.kind == Statement::Kind::Defer && !stmt.receiver.empty())) &&
                        !names.count(stmt.receiver))
                    throw std::runtime_error("unknown field receiver '" + stmt.receiver + "'");
                validate_expression(*stmt.expression, names, functions);
            };
            for (const auto& stmt : fn.statements)
                check_statement_names(stmt, params);
            // Validate effects in lexical order. In particular, a send after
            // stop must not pass by consulting the all-spawns reference map.
            for (const auto& action : fn.actor_actions) {
                if (action.kind == ActorAction::Kind::Send) {
                    const auto& send = fn.actor_sends.at(action.index);
                    if (!references.count(send.reference))
                        throw std::runtime_error("unknown actor message receiver '" + send.reference + "'");
                    if (!live_actors.count(send.reference))
                        throw std::runtime_error("actor message sent after stop '" + send.reference + "'");
                    validate_expression(*send.payload, params, functions);
                } else {
                    const auto& stop = fn.actor_stops.at(action.index);
                    if (!live_actors.erase(stop))
                        throw std::runtime_error("invalid or repeated actor stop '" + stop + "'");
                }
            }
            if (!live_actors.empty())
                throw std::runtime_error("actor reference must be stopped before return");
            for (const auto& guard : fn.early_returns) {
                validate_expression(*guard.lhs, params, functions);
                validate_expression(*guard.rhs, params, functions);
                validate_expression(*guard.result, params, functions);
            }
            if (fn.result) validate_expression(*fn.result, params, functions);
        }
    }

    void advance() { token_ = lexer_.next(); }
    [[noreturn]] void fail(const std::string& reason) const {
        if (token_.text == "gpu" || token_.text == "quantum") {
            throw std::runtime_error("native gpu/quantum boundary unsupported: "
                    "validated effects, ownership, device lowering and explicit "
                    "backend admission required; no implicit CPU fallback at byte "
                    + std::to_string(token_.offset));
        }
        // Syntactic admission is a safety boundary: rejecting actor/channel
        // keywords also means no unverified borrowed reference can enter a
        // suspended/native execution frame or deferred callback.
        if (token_.text == "select" || token_.text == "readch" ||
            token_.text == "writech" || token_.text == "nb" ||
            token_.text == "do" || token_.text == "await" ||
            token_.text == "yield" || token_.text == "cooperate") {
            throw std::runtime_error(
                "native async/channel/select boundary unsupported: "
                "suspension-aware borrow checking and cancellation/actor lowering required"
                " at byte " + std::to_string(token_.offset));
        }
        throw std::runtime_error(reason + " at byte " + std::to_string(token_.offset));
    }

    Lexer lexer_;
    Token token_;
    bool experimental_owned_int_;
};

} // namespace

Program parse_program(std::string_view source, bool experimental_owned_int) {
    Program program = Parser(source, experimental_owned_int).parse();
    // LLVM lowering is prohibited unless the native subset has passed both
    // name/arity checking and flow-sensitive explicit ownership admission.
    validate_i64_ownership(program);
    return program;
}

} // namespace oreslang

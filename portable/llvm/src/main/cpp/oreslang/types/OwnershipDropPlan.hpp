#pragma once

#include "oreslang/types/OwnershipCfg.hpp"

#include <cstddef>
#include <map>
#include <set>
#include <string>
#include <utility>
#include <vector>

namespace oreslang::ownership {

// A native-host drop planner for non-Copy resources, derived from the existing
// field-sensitive CFG fixed point. This does NOT admit new Oreslang syntax.
// The lowerer must allocate a *real* initialized flag for each conditional
// drop and use the same source declaration order on every exit path.
struct DropField {
    std::string place;
    ValueMask possible; // abstract ownership state at this CFG exit
};

struct DropExit {
    std::size_t block_index;
    std::vector<DropField> fields; // reverse source declaration order
};

inline std::vector<DropExit> plan_drop_exits(
        const Graph& graph, const std::vector<std::string>& declaration_order) {
    const Analysis analysis = verify(graph);
    std::set<std::string> unique(declaration_order.begin(), declaration_order.end());
    if (unique.size() != declaration_order.size() ||
            unique.size() != graph.entry.size())
        throw std::runtime_error("ownership violation: invalid drop layout");
    for (const auto& [name, unused] : graph.entry) {
        (void)unused;
        if (!unique.count(name)) violation(name, "missing drop-layout place");
    }
    std::vector<DropExit> result;
    for (std::size_t i = 0; i < graph.blocks.size(); ++i) {
        if (!graph.blocks[i].successors.empty() || !analysis.outgoing[i]) continue;
        DropExit exit{i, {}};
        for (auto it = declaration_order.rbegin(); it != declaration_order.rend(); ++it) {
            const auto found = analysis.outgoing[i]->find(*it);
            if (found == analysis.outgoing[i]->end())
                violation(*it, "missing CFG exit field");
            if (found->second.shared_loans || found->second.exclusive_loan)
                violation(*it, "drop with live loan");
            exit.fields.push_back({*it, found->second.possible});
        }
        result.push_back(std::move(exit));
    }
    return result;
}

// A concrete ownership flag and one noexcept native destructor per field.
// The callback is a trusted runtime capability, never guest-controlled.
struct DropSlot {
    ValueMask state = kUninitialized; // exactly one concrete state bit
    void* address = nullptr;
    void (*destroy)(void*) noexcept = nullptr;
};
using DropSlots = std::map<std::string, DropSlot>;

// Entire exit is checked *before* calling any destructor. Mark the slot
// Dropped before dispatch so a destructor cannot observe a still-live owner.
// Destructors must be noexcept. This is not exception/unwind lowering.
inline void run_drop_exit(const DropExit& exit, DropSlots& slots) {
    // Drop plans must cover every runtime-owned field exactly once. A
    // partially described owner could otherwise be silently leaked, while
    // a duplicated place could trigger inconsistent destructor sequencing.
    if (slots.size() != exit.fields.size())
        throw std::runtime_error("ownership violation: drop slot/layout size mismatch");
    // An exit plan is already bounded by its tracked places. Validate it
    // without allocating temporary hash/set nodes at teardown: memory
    // pressure must not itself prevent execution of an otherwise valid drop.
    for (std::size_t index = 0; index < exit.fields.size(); ++index) {
        const auto& field = exit.fields[index];
        if (!field.possible || (field.possible &
                static_cast<ValueMask>(~(kOwned | kMoved | kUninitialized | kDropped))))
            violation(field.place, "invalid abstract drop state");
        const auto it = slots.find(field.place);
        if (it == slots.end()) violation(field.place, "missing native drop slot");
        const DropSlot& slot = it->second;
        if (slot.state != kOwned && slot.state != kMoved &&
                slot.state != kUninitialized && slot.state != kDropped)
            violation(field.place, "ambiguous concrete drop flag");
        if (!(field.possible & slot.state))
            violation(field.place, "runtime drop flag violates CFG proof");
        if (slot.state == kOwned) {
            if (!slot.address || !slot.destroy)
                violation(field.place, "live resource lacks destructor capability");
        } else if (slot.address || slot.destroy) {
            // No moved/dropped/uninitialized place may retain a stale
            // owning pointer or destructor callback.
            violation(field.place, "inactive field retains destructor capability");
        }
        // Check all preceding places for duplicate identity or destructor
        // capability aliases. The admitted class layout is bounded and
        // this preflight uses no scratch allocations.
        for (std::size_t prior = 0; prior < index; ++prior) {
            const auto& previous = exit.fields[prior];
            if (previous.place == field.place)
                violation(field.place, "duplicate exit drop place");
            const auto earlier = slots.find(previous.place);
            if (slot.state == kOwned && earlier != slots.end() &&
                    earlier->second.state == kOwned &&
                    earlier->second.address == slot.address)
                violation(field.place, "duplicate native destructor ownership");
        }
    }
    for (const auto& field : exit.fields) {
        DropSlot& slot = slots.at(field.place);
        if (slot.state != kOwned) continue;
        void* address = slot.address;
        auto* destroy = slot.destroy;
        slot.state = kDropped;
        slot.address = nullptr;
        slot.destroy = nullptr;
        destroy(address);
    }
}

} // namespace oreslang::ownership

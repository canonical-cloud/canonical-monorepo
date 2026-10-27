#include <atomic>
#include <cstdint>
#include <cstdlib>
#include <fcntl.h>
#include <iostream>
#include <sys/socket.h>
#include <unistd.h>

static void check(bool value) {
    if (!value) std::abort();
}

class ConnectionOwner {
public:
    enum class Direction : std::uint8_t { read = 1, write = 2 };
    struct Lease {
        int fd = -1;
        std::uint64_t descriptor_generation = 0;
        std::uint64_t direction_generation = 0;
        Direction direction = Direction::read;
    };

    explicit ConnectionOwner(int fd)
        : fd_(fd), descriptor_generation_(next_descriptor_generation()) {
        check(fd_ >= 0);
    }

    ~ConnectionOwner() {
        close();
        check(retired());
    }

    bool acquire_read(Lease* out) { return acquire(Direction::read, out); }
    bool acquire_write(Lease* out) { return acquire(Direction::write, out); }

    bool release(Lease lease) {
        if (lease.fd < 0 || lease.descriptor_generation != descriptor_generation_
                || lease.direction_generation == 0)
            return false;
        std::atomic<std::uint64_t>& generation =
                lease.direction == Direction::read ? read_generation_ : write_generation_;
        if (generation.load(std::memory_order_acquire) != lease.direction_generation)
            return false;
        const std::uint32_t bit = lease.direction == Direction::read ? kRead : kWrite;
        std::uint32_t observed = state_.load(std::memory_order_acquire);
        for (;;) {
            if ((observed & bit) == 0) return false;
            if (state_.compare_exchange_weak(
                    observed, observed & ~bit,
                    std::memory_order_acq_rel,
                    std::memory_order_acquire)) {
                try_retire();
                return true;
            }
        }
    }

    void close() {
        state_.fetch_or(kClosed, std::memory_order_acq_rel);
        try_retire();
    }

    bool retired() const {
        return (state_.load(std::memory_order_acquire) & kRetired) != 0;
    }

    bool read_leased() const {
        return (state_.load(std::memory_order_acquire) & kRead) != 0;
    }

    bool write_leased() const {
        return (state_.load(std::memory_order_acquire) & kWrite) != 0;
    }

    int fd() const { return retired() ? -1 : fd_; }
    std::uint64_t descriptor_generation() const { return descriptor_generation_; }

private:
    static constexpr std::uint32_t kRead = 1u << 0;
    static constexpr std::uint32_t kWrite = 1u << 1;
    static constexpr std::uint32_t kClosed = 1u << 2;
    static constexpr std::uint32_t kRetired = 1u << 3;

    static std::uint64_t next_descriptor_generation() {
        const auto generation = descriptor_sequence_.fetch_add(1, std::memory_order_acq_rel);
        check(generation != 0 && generation != UINT64_MAX);
        return generation;
    }

    bool acquire(Direction direction, Lease* out) {
        if (!out) return false;
        const std::uint32_t bit = direction == Direction::read ? kRead : kWrite;
        std::uint32_t observed = state_.load(std::memory_order_acquire);
        for (;;) {
            if ((observed & (kClosed | kRetired | bit)) != 0) return false;
            if (!state_.compare_exchange_weak(
                    observed, observed | bit,
                    std::memory_order_acq_rel,
                    std::memory_order_acquire))
                continue;
            std::atomic<std::uint64_t>& generation =
                    direction == Direction::read ? read_generation_ : write_generation_;
            const auto next = generation.fetch_add(1, std::memory_order_acq_rel) + 1;
            check(next != 0 && next != UINT64_MAX);
            *out = Lease{fd_, descriptor_generation_, next, direction};
            return true;
        }
    }

    void try_retire() {
        std::uint32_t observed = state_.load(std::memory_order_acquire);
        for (;;) {
            if ((observed & kClosed) == 0
                    || (observed & (kRead | kWrite)) != 0
                    || (observed & kRetired) != 0)
                return;
            if (state_.compare_exchange_weak(
                    observed, observed | kRetired,
                    std::memory_order_acq_rel,
                    std::memory_order_acquire)) {
                ::close(fd_);
                fd_ = -1;
                return;
            }
        }
    }

    inline static std::atomic<std::uint64_t> descriptor_sequence_{1};
    int fd_;
    const std::uint64_t descriptor_generation_;
    std::atomic<std::uint32_t> state_{0};
    std::atomic<std::uint64_t> read_generation_{0};
    std::atomic<std::uint64_t> write_generation_{0};
};

int main() {
    int pair1[2];
    check(::socketpair(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0, pair1) == 0);
    ConnectionOwner::Lease stale{};
    std::uint64_t first_generation = 0;
    {
        ConnectionOwner owner(pair1[0]);
        first_generation = owner.descriptor_generation();
        ConnectionOwner::Lease read1{}, write1{}, duplicate{};
        check(owner.acquire_read(&read1));
        check(owner.acquire_write(&write1));
        check(!owner.acquire_read(&duplicate));
        check(!owner.acquire_write(&duplicate));

        check(owner.release(read1));
        check(!owner.release(read1));
        ConnectionOwner::Lease read2{};
        check(owner.acquire_read(&read2));
        check(read2.direction_generation > read1.direction_generation);
        stale = read1;

        const int physical = owner.fd();
        owner.close();
        check(!owner.retired());
        check(::fcntl(physical, F_GETFD) >= 0);
        check(owner.release(write1));
        check(!owner.retired());
        check(owner.release(read2));
        check(owner.retired());
        check(::fcntl(physical, F_GETFD) == -1);
    }
    ::close(pair1[1]);

    int pair2[2];
    check(::socketpair(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0, pair2) == 0);
    {
        ConnectionOwner owner(pair2[0]);
        ConnectionOwner::Lease fresh{};
        check(owner.acquire_read(&fresh));
        check(owner.descriptor_generation() != first_generation);
        check(!owner.release(stale));
        check(owner.read_leased());
        check(owner.release(fresh));
        owner.close();
        check(owner.retired());
    }
    ::close(pair2[1]);

    std::cout << "SOURCE_FREE_NATIVE_CONNECTION_OWNER_PASS\n";
    return 0;
}

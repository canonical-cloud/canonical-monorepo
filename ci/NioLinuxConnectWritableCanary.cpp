#include <arpa/inet.h>
#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <fcntl.h>
#include <iostream>
#include <netinet/in.h>
#include <sys/epoll.h>
#include <sys/socket.h>
#include <unistd.h>

static void check(bool value, const char* message) {
    if (!value) {
        std::cerr << message << "\n";
        std::abort();
    }
}

static int nonblocking_socket() {
    int fd = ::socket(AF_INET, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    check(fd >= 0, "socket");
    return fd;
}

static int loopback_listener(std::uint16_t* port) {
    int fd = nonblocking_socket();
    int reuse = 1;
    check(::setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse)) == 0,
          "setsockopt");
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = ::htonl(INADDR_LOOPBACK);
    addr.sin_port = 0;
    check(::bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0, "bind");
    check(::listen(fd, 8) == 0, "listen");
    socklen_t n = sizeof(addr);
    check(::getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &n) == 0,
          "getsockname");
    *port = ::ntohs(addr.sin_port);
    return fd;
}

static int finish_connect(int client, std::uint16_t port) {
    sockaddr_in addr{};
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = ::htonl(INADDR_LOOPBACK);
    addr.sin_port = ::htons(port);
    int rc = ::connect(client, reinterpret_cast<sockaddr*>(&addr), sizeof(addr));
    if (rc == 0) return 0;
    check(errno == EINPROGRESS || errno == EALREADY, "connect not async");

    int ep = ::epoll_create1(EPOLL_CLOEXEC);
    check(ep >= 0, "epoll_create1");
    epoll_event registration{};
    registration.events = EPOLLOUT | EPOLLONESHOT | EPOLLERR | EPOLLHUP;
    registration.data.u64 = UINT64_C(0x8111);
    check(::epoll_ctl(ep, EPOLL_CTL_ADD, client, &registration) == 0, "epoll add");

    epoll_event ready{};
    int count;
    do {
        count = ::epoll_wait(ep, &ready, 1, 3000);
    } while (count < 0 && errno == EINTR);
    check(count == 1, "EPOLLOUT timeout");
    check(ready.data.u64 == UINT64_C(0x8111), "wrong epoll token");
    check((ready.events & (EPOLLOUT | EPOLLERR | EPOLLHUP)) != 0,
          "missing connect readiness");

    int socket_error = 0;
    socklen_t length = sizeof(socket_error);
    check(::getsockopt(client, SOL_SOCKET, SO_ERROR, &socket_error, &length) == 0,
          "SO_ERROR");
    check(length == sizeof(socket_error), "SO_ERROR length");
    ::close(ep);
    return socket_error;
}

static void successful_connect() {
    std::uint16_t port = 0;
    int listener = loopback_listener(&port);
    int client = nonblocking_socket();
    check(finish_connect(client, port) == 0, "connect success SO_ERROR");

    int accepted = -1;
    for (int i = 0; i < 3000 && accepted < 0; ++i) {
        accepted = ::accept4(listener, nullptr, nullptr, SOCK_NONBLOCK | SOCK_CLOEXEC);
        if (accepted < 0) {
            check(errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR,
                  "accept error");
            ::usleep(1000);
        }
    }
    check(accepted >= 0, "accept timeout");
    check((::fcntl(client, F_GETFL, 0) & O_NONBLOCK) != 0, "client became blocking");
    check((::fcntl(client, F_GETFD, 0) & FD_CLOEXEC) != 0, "client lost CLOEXEC");
    ::close(accepted);
    ::close(client);
    ::close(listener);
}

static void refused_connect() {
    std::uint16_t port = 0;
    int reservation = loopback_listener(&port);
    ::close(reservation);
    int client = nonblocking_socket();
    int error = finish_connect(client, port);
    check(error != 0 && error != EINPROGRESS && error != EALREADY,
          "refused connect did not become terminal error");
    ::close(client);
}

static void writable_readiness_requires_capacity() {
    int pipefd[2];
    check(::pipe2(pipefd, O_NONBLOCK | O_CLOEXEC) == 0, "pipe2");
    unsigned char bytes[4096]{};
    std::size_t filled = 0;
    for (;;) {
        ssize_t n = ::write(pipefd[1], bytes, sizeof(bytes));
        if (n > 0) {
            filled += static_cast<std::size_t>(n);
            continue;
        }
        if (n < 0 && errno == EINTR) continue;
        check(n < 0 && (errno == EAGAIN || errno == EWOULDBLOCK), "fill pipe");
        break;
    }
    check(filled > 0, "pipe did not fill");

    int ep = ::epoll_create1(EPOLL_CLOEXEC);
    check(ep >= 0, "epoll pipe");
    epoll_event reg{};
    reg.events = EPOLLOUT | EPOLLONESHOT;
    reg.data.u64 = UINT64_C(0x8222);
    check(::epoll_ctl(ep, EPOLL_CTL_ADD, pipefd[1], &reg) == 0, "epoll add pipe");
    epoll_event event{};
    check(::epoll_wait(ep, &event, 1, 30) == 0,
          "full pipe was spuriously writable");

    std::size_t remaining = filled;
    while (remaining > 0) {
        std::size_t want = remaining < sizeof(bytes) ? remaining : sizeof(bytes);
        ssize_t n = ::read(pipefd[0], bytes, want);
        if (n > 0) {
            remaining -= static_cast<std::size_t>(n);
            continue;
        }
        if (n < 0 && errno == EINTR) continue;
        check(false, "drain pipe");
    }

    int count;
    do {
        count = ::epoll_wait(ep, &event, 1, 3000);
    } while (count < 0 && errno == EINTR);
    check(count == 1, "EPOLLOUT did not wake after drain");
    check(event.data.u64 == UINT64_C(0x8222), "wrong writable token");
    check((event.events & EPOLLOUT) != 0, "missing EPOLLOUT");

    ::close(ep);
    ::close(pipefd[0]);
    ::close(pipefd[1]);
}

int main() {
    successful_connect();
    refused_connect();
    writable_readiness_requires_capacity();
    std::cout << "SOURCE_FREE_LINUX_EPOLL_CONNECT_WRITABLE_PASS\n";
    return 0;
}

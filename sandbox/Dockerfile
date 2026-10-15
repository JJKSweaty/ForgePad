FROM debian:bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends gcc g++ clang libclang-rt-14-dev libc6-dev libstdc++-12-dev \
    && rm -rf /var/lib/apt/lists/*
RUN mkdir -p /work /src /build /program
USER 65534:65534
WORKDIR /work
CMD ["/usr/bin/gcc", "--version"]

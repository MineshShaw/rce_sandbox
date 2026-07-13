FROM node:20-slim

RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*
RUN useradd -m -s /bin/bash sandboxuser
WORKDIR /workspace

ENTRYPOINT ["/usr/bin/tini", "--"]
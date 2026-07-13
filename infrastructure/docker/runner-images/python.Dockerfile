FROM python:3.11-slim

# Install tini for strict process management and zombie reaping
RUN apt-get update && apt-get install -y tini && rm -rf /var/lib/apt/lists/*

# Create a non-privileged user with no root access
RUN useradd -m -s /bin/bash sandboxuser

# Set the working directory where our tmpfs will be mounted
WORKDIR /workspace

# Force tini to be PID 1
ENTRYPOINT ["/usr/bin/tini", "--"]

# Default command waits for stdin
CMD ["python3", "-"]
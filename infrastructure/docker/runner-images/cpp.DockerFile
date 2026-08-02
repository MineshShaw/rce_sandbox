FROM gcc:latest

# Create a secure, non-root user
RUN useradd -m sandboxuser

# Set up the working directory
WORKDIR /workspace

# THE FIX: Give ownership AND full read/write/execute permissions to the workspace
RUN chown -R sandboxuser:sandboxuser /workspace && chmod -R 777 /workspace

# Drop root privileges
USER sandboxuser

# Keep the container alive so we can inject code into it
CMD ["tail", "-f", "/dev/null"]
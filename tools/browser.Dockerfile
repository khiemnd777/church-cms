FROM oven/bun:1.3.1 AS bun
FROM mcr.microsoft.com/playwright:v1.56.1-noble
USER root
RUN apt-get update && apt-get install -y --no-install-recommends libnss3-tools && rm -rf /var/lib/apt/lists/*
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
RUN install -d -o pwuser -g pwuser /work/output
USER pwuser
WORKDIR /work

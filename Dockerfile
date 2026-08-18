ARG NODE_IMAGE=node:22-bookworm
FROM ${NODE_IMAGE}

ARG MOSS_VERSION=latest
ARG PLAYWRIGHT_VERSION=1.62.1
RUN npm install --global "@rdk-moss/agent@${MOSS_VERSION}" \
    && npm cache clean --force

ENV PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright
RUN npx --yes "playwright@${PLAYWRIGHT_VERSION}" install --with-deps chromium \
    && browser_path="$(find /opt/ms-playwright -type f -path '*/chrome-linux*/chrome' | head -n 1)" \
    && test -n "$browser_path" \
    && ln -s "$browser_path" /usr/local/bin/moss-chromium \
    && chmod -R a+rX /opt/ms-playwright \
    && npm cache clean --force
ENV MOSS_BROWSER_EXECUTABLE=/usr/local/bin/moss-chromium

RUN useradd --create-home --uid 10001 moss-eval
USER moss-eval
WORKDIR /workspace

ENTRYPOINT []
CMD ["moss", "--help"]

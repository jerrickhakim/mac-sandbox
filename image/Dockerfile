# syntax=docker/dockerfile:1
FROM amazonlinux:2023

SHELL ["/bin/bash", "-lc"]

# ---- Base packages (Vercel list) + sudo + certs ----
# Apple Containers + AL2023 often ships curl-minimal. Never install curl directly without handling that.
RUN dnf -y update && \
    dnf -y install \
      bind-utils \
      bzip2 \
      findutils \
      git \
      gzip \
      iputils \
      libicu \
      libjpeg \
      libpng \
      ncurses-libs \
      openssl \
      openssl-libs \
      procps \
      tar \
      unzip \
      which \
      whois \
      zstd \
      sudo \
      ca-certificates \
      shadow-utils \
      xz \
    && dnf clean all

# ---- Build deps (only needed if Python 3.13 isn’t available via dnf) ----
RUN dnf -y install \
      make gcc gcc-c++ pkgconfig \
      zlib-devel bzip2-devel xz-devel libffi-devel \
      openssl-devel readline-devel sqlite-devel \
    && dnf clean all

# ---- Create vercel-sandbox user + directories ----
RUN useradd -m -s /bin/bash vercel-sandbox && \
    mkdir -p /vercel/sandbox /vercel/runtimes/node24 /vercel/runtimes/node22 /vercel/runtimes/python && \
    chown -R vercel-sandbox:vercel-sandbox /vercel

# ---- Sudo config: HOME=/root, keep PATH, preserve env ----
RUN cat > /etc/sudoers.d/vercel-sandbox <<'EOF' && chmod 0440 /etc/sudoers.d/vercel-sandbox
Defaults        set_home
Defaults        !secure_path
Defaults        env_keep += "*"
vercel-sandbox  ALL=(ALL) NOPASSWD:ALL
EOF

# ---- Install Node 24 + Node 22 into /vercel/runtimes/... ----
# ---- Install Node 24 + Node 22 into /vercel/runtimes/... ----
    ARG NODE24_VERSION=24.0.0
    ARG NODE22_VERSION=22.0.0
    ARG PNPM_VERSION=9.15.0
    
    RUN set -euo pipefail; \
        arch="$(uname -m)"; \
        case "$arch" in \
          x86_64) node_arch="x64" ;; \
          aarch64) node_arch="arm64" ;; \
          *) echo "Unsupported arch: $arch" && exit 1 ;; \
        esac; \
        \
        curl -fsSL "https://nodejs.org/dist/v${NODE24_VERSION}/node-v${NODE24_VERSION}-linux-${node_arch}.tar.xz" -o /tmp/node24.tar.xz; \
        tar -xJf /tmp/node24.tar.xz -C /vercel/runtimes/node24 --strip-components=1; \
        rm -f /tmp/node24.tar.xz; \
        \
        curl -fsSL "https://nodejs.org/dist/v${NODE22_VERSION}/node-v${NODE22_VERSION}-linux-${node_arch}.tar.xz" -o /tmp/node22.tar.xz; \
        tar -xJf /tmp/node22.tar.xz -C /vercel/runtimes/node22 --strip-components=1; \
        rm -f /tmp/node22.tar.xz; \
        \
        # Install pnpm explicitly (avoid corepack flakiness in container builds)
        /vercel/runtimes/node24/bin/node /vercel/runtimes/node24/bin/npm install -g "pnpm@${PNPM_VERSION}"; \
        \
        # Make node24 default runtime on PATH
        ln -sf /vercel/runtimes/node24/bin/node /usr/local/bin/node; \
        ln -sf /vercel/runtimes/node24/bin/npm  /usr/local/bin/npm; \
        ln -sf /vercel/runtimes/node24/bin/npx  /usr/local/bin/npx; \
        ln -sf /vercel/runtimes/node24/bin/pnpm /usr/local/bin/pnpm

# ---- Install Python 3.13 into /vercel/runtimes/python ----
ARG PYTHON_VERSION=3.13.1

RUN set -euo pipefail; \
    if dnf -y install python3.13 python3.13-pip >/dev/null 2>&1; then \
      PYBIN="$(command -v python3.13)"; \
      PIPBIN="$(command -v pip3.13 || true)"; \
      mkdir -p /vercel/runtimes/python/bin; \
      ln -sf "$PYBIN" /vercel/runtimes/python/bin/python; \
      ln -sf "$PYBIN" /vercel/runtimes/python/bin/python3; \
      ln -sf "$PYBIN" /vercel/runtimes/python/bin/python3.13; \
      if [[ -n "${PIPBIN}" ]]; then ln -sf "$PIPBIN" /vercel/runtimes/python/bin/pip; fi; \
    else \
      echo "python3.13 not available via dnf; building Python ${PYTHON_VERSION} from source..."; \
      curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tgz" -o /tmp/py.tgz; \
      tar -xzf /tmp/py.tgz -C /tmp; \
      pushd "/tmp/Python-${PYTHON_VERSION}"; \
      ./configure --prefix=/vercel/runtimes/python --enable-optimizations --with-ensurepip=install; \
      make -j"$(nproc)"; \
      make install; \
      popd; \
      rm -rf "/tmp/Python-${PYTHON_VERSION}" /tmp/py.tgz; \
    fi

ENV HOME=/home/vercel-sandbox
WORKDIR /vercel/sandbox
USER vercel-sandbox

CMD ["bash", "-lc", "whoami && pwd && node -v && pnpm -v && python3 --version || true"]
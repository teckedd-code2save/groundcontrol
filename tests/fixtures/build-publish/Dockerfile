FROM alpine:3.22
LABEL org.opencontainers.image.source="https://github.com/teckedd-code2save/groundcontrol"
ARG PROOF_FAIL=0
RUN if [ "$PROOF_FAIL" = 1 ]; then seq 1 12000; echo GC_PROOF_FINAL_BUILD_FAILURE >&2; exit 17; fi
RUN printf 'groundcontrol-build-proof\n' > /proof
CMD ["cat", "/proof"]

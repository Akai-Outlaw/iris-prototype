# Galaxy demo

From the repository root, run `npm ci` and `npm run dev`. Open `http://127.0.0.1:1420/?demo=1` for the explicitly labeled six-state demonstration. It does not connect an assistant, microphone, or speech provider.

The standalone renderer lives in `packages/galaxy-engine`; its contracts and visual targets are separate workspace packages. Browser regression checks exercise context restoration and teardown without establishing native performance acceptance.

# Project Guidance

## Deploy Configuration (configured by /setup-deploy)
- Platform: Vercel
- Production URL: https://feishu-profile-control.vercel.app
- Deploy workflow: automatic production deployment on push to main
- Deploy status command: `npx vercel inspect feishu-profile-control.vercel.app`
- Merge method: fast-forward
- Project type: static hosted UI with a local Node.js control connector
- Post-deploy health check: https://feishu-profile-control.vercel.app

### Custom deploy hooks
- Pre-merge: `npm run check && npm run vercel-build`
- Deploy trigger: automatic on push to main
- Deploy status: `npx vercel inspect feishu-profile-control.vercel.app`
- Health check: `curl -fsS https://feishu-profile-control.vercel.app`

The hosted UI must never receive Feishu credentials or raw local profile data at build time. It connects from the user's browser to the loopback connector, whose exact allowed origins are configured locally.

# Public source preparation

The existing RHODA repository contains third-party assets in its Git history. It must not simply be switched to public on the assumption that deleting those files in a new commit removes their old copies.

The [Ready Player Me animation-library licence](https://github.com/readyplayerme/animation-library/blob/master/LICENSE.md) requires prior written permission to redistribute original or modified animations. The private checkout includes 44 matching motion files. The original Ready Player Me avatar also lacks a retained, reviewed redistribution/attribution record. This preparation excludes both, rather than assuming the SDK's software licence applies to those assets.

## Prepare a separate source snapshot

Run `node scripts/export-public-source.mjs` from the main project. It writes the current allowlisted source and permitted public assets to `.tmp/public-source`. This is a local preparation step: it does not initialize Git, commit, change remotes, publish files, change repository visibility or invite anyone.

The destination has no inherited history. The script does not read `.env.local` or copy environment secrets, runtime learner/session data, document collections, reports, local build caches, nested duplicate projects, dependency folders or installers. The 15 short authored Markdown guides under `server/rag/corpus/` remain as built-in teaching content; this narrow exception does not include removed private `docs/` files or the external document collection. Root README content is replaced with contributor-focused instructions rather than exporting historical local paths and delivery claims. A manifest records copied-file hashes and exclusion categories without private excluded filenames or absolute paths.

The script replaces only a previous ownership-marked export inside this checkout's `.tmp` directory. It refuses linked/outside destinations, an unmarked existing directory, or a destination that already contains `.git`. A published snapshot must be updated deliberately; this exporter never deletes its Git history.

## Included model assets

- `lab-companion.glb`: Microsoft Rocketbox Medical_Male_01 and native motions, with the retained MIT notice and pinned-source credit record.
- `research-companion.glb`, `companion-motions.glb` and `companion-walk.glb`: credited CC0 fallback character and motions, with their source records.
- Original project model geometry for the oscilloscope and VNA and the existing user-provided lab icon. Manufacturer branding identifies the educational reference; no endorsement is asserted.

All Ready Player Me motion directories, previews and `rhode_schwarz-character.glb` are excluded. The public manifest for those optional clips starts empty. The copied spatial-studio entry page explicitly marks the original avatar unavailable so its runtime can choose the permitted companion without probing for the excluded download. The old private checkout remains unchanged.

## Verification before publication

Review the generated snapshot and its manifest, install the pinned root and VNA-module dependencies, and run TypeScript/build and focused browser checks from the snapshot. In particular, verify that spatial-studio initialization handles the intentionally absent original avatar; the original loader's failure is not automatically recovered merely because a separate companion loader exists. The public app must use a permitted companion or remain usable without an avatar before it is described as operational.

No blanket project licence is invented by the exporter. Each included third-party library or asset retains its own terms. A filename/pattern audit is not proof that every line is confidential-data-free; inspect the final staged diff and public snapshot. This document records preparation, not a claim that publication, clean-device operation, hardware operation or permissions review is complete.

Once publication has been authorized and completed, send the actual public repository URL. To grant write access, the owner must also invite the friend's exact GitHub username in repository collaborator settings; a public URL alone permits reading/forking but does not make the recipient a collaborator.

/**
 * Which Axive this window belongs to. Axive Free builds this same front end
 * (scripts/build-gui.mjs reads the edition from package.json): in Free the
 * doors and switches its core does not carry are left out, and one door says
 * plainly what Axive adds.
 */
export const FREE = __AXIVE_EDITION__ === 'free'
export const PRODUCT = FREE ? 'Axive Free' : 'Axive'
export const UPGRADE_URL = 'https://axive.xyz/?ref=free'

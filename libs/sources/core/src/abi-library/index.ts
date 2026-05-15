// ABI sources: ERC-20 (public domain), OpenZeppelin MIT.
// Standard interface ABIs are not copyrightable; sourced from their canonical
// open-source repositories. Kept here so any source package can reference them
// without duplicating the JSON.
import erc20 from './erc20.json' with { type: 'json' };
import ozAccessControl from './oz-access-control.json' with { type: 'json' };
import ozGovernor from './oz-governor.json' with { type: 'json' };

export const ERC20_ABI: readonly unknown[] = erc20;
export const OZ_ACCESS_CONTROL_ABI: readonly unknown[] = ozAccessControl;
export const OZ_GOVERNOR_ABI: readonly unknown[] = ozGovernor;

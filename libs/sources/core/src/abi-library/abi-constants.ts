import erc20 from './erc20.json' with { type: 'json' };
import ozAccessControl from './oz-access-control.json' with { type: 'json' };
import ozGovernor from './oz-governor.json' with { type: 'json' };

export const ERC20_ABI: readonly unknown[] = erc20;
export const OZ_ACCESS_CONTROL_ABI: readonly unknown[] = ozAccessControl;
export const OZ_GOVERNOR_ABI: readonly unknown[] = ozGovernor;

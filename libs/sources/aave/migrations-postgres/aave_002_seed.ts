import type { Kysely } from 'kysely';
import { sql } from 'kysely';

const SOURCE_TYPES = [
  'aave_governance_v3',
  'aave_voting_machine',
  'aave_payloads_controller',
  'aave_payloads_controller_reconcile',
  'aave_governor_v2',
  'aave_governance_v3_reconcile',
  'aave_governor_v2_reconcile',
] as const;

// Addresses extracted from @bgd-labs/aave-address-book@4.44.22
// (gitHead 5858e016e53194f8a4af214cf8ffff93ee7b7bdb).
// active_from_block values are conservative first-code blocks derived from public
// JSON-RPC archive probes, except Arbitrum which is the Arbiscan contract-creation block.
export const AAVE_GOVERNANCE_V3_DEPLOY_BLOCK = 18119225;
export const AAVE_VOTING_MACHINE_ETHEREUM_DEPLOY_BLOCK = 22065802;
export const AAVE_VOTING_MACHINE_POLYGON_DEPLOY_BLOCK = 69155019;
export const AAVE_VOTING_MACHINE_AVALANCHE_DEPLOY_BLOCK = 58844887;
export const AAVE_GOVERNOR_V2_DEPLOY_BLOCK = 11427398;

type DaoSourceSeed = {
  sourceType: (typeof SOURCE_TYPES)[number];
  chainId: string;
  config: Record<string, string | boolean>;
  activeFromBlock: number;
};

const DAO_SOURCE_SEEDS: DaoSourceSeed[] = [
  {
    sourceType: 'aave_governance_v3',
    chainId: '0x1',
    config: { governance_address: '0x9AEE0B04504CeF83A65AC3f0e838D0593BCb2BC7' },
    activeFromBlock: AAVE_GOVERNANCE_V3_DEPLOY_BLOCK,
  },
  {
    sourceType: 'aave_voting_machine',
    chainId: '0x1',
    config: { voting_machine_address: '0x06a1795a88b82700896583e123F46BE43877bFb6' },
    activeFromBlock: AAVE_VOTING_MACHINE_ETHEREUM_DEPLOY_BLOCK,
  },
  {
    sourceType: 'aave_voting_machine',
    chainId: '0x89',
    config: { voting_machine_address: '0x44c8b753229006A8047A05b90379A7e92185E97C' },
    activeFromBlock: AAVE_VOTING_MACHINE_POLYGON_DEPLOY_BLOCK,
  },
  {
    sourceType: 'aave_voting_machine',
    chainId: '0xa86a',
    config: { voting_machine_address: '0x4D1863d22D0ED8579f8999388BCC833CB057C2d6' },
    activeFromBlock: AAVE_VOTING_MACHINE_AVALANCHE_DEPLOY_BLOCK,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x1',
    config: { payloads_controller_address: '0xdAbad81aF85554E9ae636395611C58F7eC1aAEc5' },
    activeFromBlock: 18119740,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x89',
    config: { payloads_controller_address: '0x401B5D0294E23637c18fcc38b1Bca814CDa2637C' },
    activeFromBlock: 47449617,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0xa86a',
    config: { payloads_controller_address: '0x1140CB7CAfAcC745771C2Ea31e7B5C653c5d0B80' },
    activeFromBlock: 35087182,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0xa4b1',
    config: { payloads_controller_address: '0x89644CA1bB8064760312AE4F03ea41b05dA3637C' },
    activeFromBlock: 130388802,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0xa',
    config: { payloads_controller_address: '0x0E1a3Af1f9cC76A62eD31eDedca291E63632e7c4' },
    activeFromBlock: 109458465,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x2105',
    config: { payloads_controller_address: '0x2DC219E716793fb4b21548C0f009Ba3Af753ab01' },
    activeFromBlock: 3865110,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x64',
    config: { payloads_controller_address: '0x9A1F491B86D09fC1484b5fab10041B189B60756b' },
    activeFromBlock: 30390469,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x38',
    config: { payloads_controller_address: '0xE5EF2Dd06755A97e975f7E282f828224F2C3e627' },
    activeFromBlock: 31675528,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x82750',
    config: { payloads_controller_address: '0x6b6B41c0f8C223715f712BE83ceC3c37bbfDC3fE' },
    activeFromBlock: 2166683,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0xe708',
    config: { payloads_controller_address: '0x3BcE23a1363728091bc57A58a226CF2940C2e074' },
    activeFromBlock: 13379933,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0xa4ec',
    config: { payloads_controller_address: '0xE48E10834C04E394A04BF22a565D063D40b9FA42' },
    activeFromBlock: 29737417,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x92',
    config: { payloads_controller_address: '0x0846C28Dd54DEA4Fd7Fb31bcc5EB81673D68c695' },
    activeFromBlock: 7282346,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x440',
    config: {
      payloads_controller_address: '0x2233F8A66A728FBa6E1dC95570B25360D07D5524',
      deprecated: true,
    },
    activeFromBlock: 8526430,
  },
  {
    sourceType: 'aave_payloads_controller',
    chainId: '0x144',
    config: {
      payloads_controller_address: '0x2E79349c3F5e4751E87b966812C9E65E805996F1',
      deprecated: true,
    },
    activeFromBlock: 40070275,
  },
  {
    sourceType: 'aave_governor_v2',
    chainId: '0x1',
    config: { governor_address: '0xEC568fffba86c094cf06b22134B23074DFE2252c' },
    activeFromBlock: AAVE_GOVERNOR_V2_DEPLOY_BLOCK,
  },
];

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    INSERT INTO source_type (value)
    VALUES ${sql.join(SOURCE_TYPES.map((value) => sql`(${value})`))}
    ON CONFLICT (value) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao (slug, name, primary_token_address, primary_chain_id,
                     description, website_url, forum_url, updated_at)
    VALUES (
      'aave',
      'Aave',
      '0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9',
      '0x1',
      'Aave is a decentralized non-custodial liquidity protocol governed by AAVE token holders.',
      'https://aave.com',
      'https://governance.aave.com',
      now()
    )
    ON CONFLICT (slug) DO NOTHING
  `.execute(db);

  for (const seed of DAO_SOURCE_SEEDS) {
    await sql`
      INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
      SELECT id,
             ${seed.sourceType},
             ${seed.chainId},
             ${JSON.stringify(seed.config)}::jsonb,
             ${sql.lit(seed.activeFromBlock)}
      FROM dao
      WHERE slug = 'aave'
      ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
    `.execute(db);
  }

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'aave_governance_v3_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'aave_governance_v3'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'aave_governor_v2_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'aave_governor_v2'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);

  await sql`
    INSERT INTO dao_source (dao_id, source_type, chain_id, source_config, active_from_block)
    SELECT dao_id, 'aave_payloads_controller_reconcile', chain_id, source_config, active_from_block
    FROM dao_source
    WHERE source_type = 'aave_payloads_controller'
    ON CONFLICT (dao_id, source_type, chain_id) DO NOTHING
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    DELETE FROM dao_source
    WHERE source_type IN (${sql.join(SOURCE_TYPES)})
      AND dao_id = (SELECT id FROM dao WHERE slug = 'aave')
  `.execute(db);

  await sql`DELETE FROM dao WHERE slug = 'aave'`.execute(db);

  // Once Aave adapters write proposals, proposal.source_type restricts this delete.
  await sql`
    DELETE FROM source_type
    WHERE value IN (${sql.join(SOURCE_TYPES)})
  `.execute(db);
}

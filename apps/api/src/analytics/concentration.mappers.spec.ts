import type { ConcentrationBucketRow } from '@libs/db';
import { toConcentrationRowDto } from './concentration.mappers';

const BUCKET = new Date('2025-01-01');

describe('toConcentrationRowDto', () => {
  it('uniform distribution — gini=0, top_share.n_1=0.25, effective_delegate_count=4', () => {
    const row: ConcentrationBucketRow = {
      bucket: BUCKET,
      weights: ['1000', '1000', '1000', '1000'],
      delegate_count: 4,
      total_voting_power: '4000',
    };
    const dto = toConcentrationRowDto(row);

    expect(dto.gini).toBe(0);
    expect(dto.top_share.n_1).toBe(0.25);
    expect(dto.effective_delegate_count).toBe(4);
  });

  it('realistic 10-delegate fixture (AC #4 gate)', () => {
    // weights sorted ascending as ClickHouse delivers them
    const row: ConcentrationBucketRow = {
      bucket: BUCKET,
      weights: ['100', '200', '300', '500', '1000', '2000', '5000', '10000', '20000', '50000'],
      delegate_count: 10,
      total_voting_power: '89100',
    };
    const dto = toConcentrationRowDto(row);

    // Σ(w_i) = 89100, Σ(i·w_i) sorted ascending with 1-based index = 815400
    // G = (2·815400 − 11·89100) / (10·89100) = 650700 / 891000 ≈ 0.7303
    expect(Math.abs(dto.gini - 0.7303)).toBeLessThan(0.001);

    // top_1 = 50000/89100 ≈ 0.5611
    expect(dto.top_share.n_1).toBeCloseTo(50000 / 89100, 4);
    // top_5 = (50000+20000+10000+5000+2000)/89100 = 87000/89100 ≈ 0.9764
    expect(dto.top_share.n_5).toBeCloseTo(87000 / 89100, 4);
    // top_10 = all delegates = 1.0
    expect(dto.top_share.n_10).toBeCloseTo(1.0, 4);

    // Herfindahl: sum_sq = 100²+200²+…+50000² = 3,030,390,000
    // effective = 89100² / 3,030,390,000 ≈ 2.620
    expect(dto.effective_delegate_count).toBeCloseTo(2.62, 2);
  });

  it('maximum concentration — gini > 0.74, top_share.n_1 ≈ 1, effective_delegate_count ≈ 1', () => {
    const row: ConcentrationBucketRow = {
      bucket: BUCKET,
      weights: ['1', '1', '1', '1000000'],
      delegate_count: 4,
      total_voting_power: '1000003',
    };
    const dto = toConcentrationRowDto(row);

    expect(dto.gini).toBeGreaterThan(0.74);
    expect(Math.abs(dto.top_share.n_1 - 1000000 / 1000003)).toBeLessThan(1e-4);
    expect(Math.abs(dto.effective_delegate_count - 1)).toBeLessThan(0.01);
  });

  it('all-zero weights — gini=0, top_share.n_1=0, effective_delegate_count=0', () => {
    const row: ConcentrationBucketRow = {
      bucket: BUCKET,
      weights: ['0', '0', '0'],
      delegate_count: 3,
      total_voting_power: '0',
    };
    const dto = toConcentrationRowDto(row);

    expect(dto.gini).toBe(0);
    expect(dto.top_share.n_1).toBe(0);
    expect(dto.effective_delegate_count).toBe(0);
  });

  it('mixed-event-type bucket — pins current behaviour: zero-power delegate_changed rows are included in weights', () => {
    // Compound emits both votes_changed (real power) and delegate_changed (power='0').
    // The per-bucket output is NOT filtered — zero rows stay in weights[] and inflate delegate_count.
    // This test pins the current behaviour so a future change to exclude zero-power rows is intentional.
    const row: ConcentrationBucketRow = {
      bucket: BUCKET,
      // 2 real votes_changed rows + 3 zero-power delegate_changed rows
      weights: ['0', '0', '0', '1000', '2000'],
      delegate_count: 5,
      total_voting_power: '3000',
    };
    const dto = toConcentrationRowDto(row);

    // The real power rows dominate; zeros deflate effective_delegate_count slightly
    expect(dto.total_voting_power).toBe('3000');
    expect(dto.delegate_count).toBe(5); // includes the zero-power rows
    expect(dto.effective_delegate_count).toBeGreaterThan(0);
    expect(dto.top_share.n_1).toBeCloseTo(2000 / 3000, 4);
  });

  it('union of v2+v3 buckets — two source-type rows map to separate DTOs correctly', () => {
    const v2Row: ConcentrationBucketRow = {
      bucket: new Date('2025-06-01'),
      weights: ['500', '500', '1000'],
      delegate_count: 3,
      total_voting_power: '2000',
    };
    const v3Row: ConcentrationBucketRow = {
      bucket: new Date('2025-07-01'),
      weights: ['100', '200', '300', '50000'],
      delegate_count: 4,
      total_voting_power: '50600',
    };
    const [dto2, dto3] = [v2Row, v3Row].map(toConcentrationRowDto);

    // v2: roughly equal weights → low Gini
    expect(dto2!.gini).toBeLessThan(0.3);
    // v3: one dominant delegate → high Gini
    expect(dto3!.gini).toBeGreaterThan(0.7);
    expect(dto2!.bucket).toBe('2025-06-01T00:00:00Z');
    expect(dto3!.bucket).toBe('2025-07-01T00:00:00Z');
  });
});

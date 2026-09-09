import { describe, expect, it } from 'vitest';
import {
  lerpScore,
  scoreDebtBurden,
  scoreEmergency,
  scoreFreedom,
  scoreInsurance,
  scoreInvestment,
  scoreLeverage,
  scoreSavings,
} from '../src/financial-health.js';

describe('lerpScore', () => {
  it('区间内线性插值并取整', () => {
    expect(lerpScore(1.5, 0, 3, 20, 50)).toBe(35); // t = 0.5
    expect(lerpScore(0.2, 0, 1, 0, 100)).toBe(20);
  });

  it('低于下界截断为 s0', () => {
    expect(lerpScore(-1, 0, 3, 20, 50)).toBe(20);
  });

  it('高于上界截断为 s1', () => {
    expect(lerpScore(10, 0, 3, 20, 50)).toBe(50);
  });

  it('x1 === x0 时返回 s1(避免除零)', () => {
    expect(lerpScore(5, 3, 3, 20, 80)).toBe(80);
  });
});

describe('scoreEmergency(应急能力,越高越健康)', () => {
  it('12 个月及以上满分', () => {
    expect(scoreEmergency(12)).toBe(100);
    expect(scoreEmergency(24)).toBe(100);
  });

  it('区间边界值', () => {
    expect(scoreEmergency(6)).toBe(80);
    expect(scoreEmergency(3)).toBe(50);
    expect(scoreEmergency(0)).toBe(20);
  });

  it('区间内插值', () => {
    expect(scoreEmergency(9)).toBe(90);
    expect(scoreEmergency(4.5)).toBe(65);
    expect(scoreEmergency(1.5)).toBe(35);
  });
});

describe('scoreDebtBurden(偿债压力,反向指标)', () => {
  it('无负债满分', () => {
    expect(scoreDebtBurden(0)).toBe(100);
  });

  it('区间边界值', () => {
    expect(scoreDebtBurden(0.35)).toBe(90);
    expect(scoreDebtBurden(0.5)).toBe(60);
    expect(scoreDebtBurden(1)).toBe(20);
  });

  it('区间内插值', () => {
    expect(scoreDebtBurden(0.425)).toBe(75);
    expect(scoreDebtBurden(0.175)).toBe(95);
  });
});

describe('scoreLeverage(杠杆水平,反向指标)', () => {
  it('区间边界值', () => {
    expect(scoreLeverage(0)).toBe(100);
    expect(scoreLeverage(0.5)).toBe(90);
    expect(scoreLeverage(0.7)).toBe(60);
    expect(scoreLeverage(1)).toBe(20);
  });

  it('区间内插值', () => {
    expect(scoreLeverage(0.6)).toBe(75);
  });
});

describe('scoreSavings(储蓄能力)', () => {
  it('区间边界值', () => {
    expect(scoreSavings(0)).toBe(20);
    expect(scoreSavings(0.1)).toBe(40);
    expect(scoreSavings(0.2)).toBe(60);
    expect(scoreSavings(0.3)).toBe(80);
    expect(scoreSavings(0.5)).toBe(100);
  });

  it('区间内插值', () => {
    expect(scoreSavings(0.15)).toBe(50);
    expect(scoreSavings(0.25)).toBe(70);
  });
});

describe('scoreInvestment(投资积累)', () => {
  it('区间边界值', () => {
    expect(scoreInvestment(0)).toBe(20);
    expect(scoreInvestment(0.2)).toBe(50);
    expect(scoreInvestment(0.5)).toBe(80);
    expect(scoreInvestment(0.8)).toBe(100);
  });

  it('超过上界截断', () => {
    expect(scoreInvestment(0.9)).toBe(100);
  });

  it('区间内插值', () => {
    expect(scoreInvestment(0.1)).toBe(35);
    expect(scoreInvestment(0.35)).toBe(65);
  });
});

describe('scoreFreedom(财务自由度)', () => {
  it('被动收入覆盖全部支出满分', () => {
    expect(scoreFreedom(1)).toBe(100);
    expect(scoreFreedom(2)).toBe(100);
  });

  it('区间边界值', () => {
    expect(scoreFreedom(0)).toBe(20);
    expect(scoreFreedom(0.2)).toBe(40);
    expect(scoreFreedom(0.5)).toBe(60);
  });

  it('区间内插值', () => {
    expect(scoreFreedom(0.75)).toBe(80);
    expect(scoreFreedom(0.35)).toBe(50);
  });
});

describe('scoreInsurance(保障充足度,5%-15% 为健康区间)', () => {
  it('峰值 10% 满分', () => {
    expect(scoreInsurance(0.1)).toBe(100);
  });

  it('健康区间边界', () => {
    expect(scoreInsurance(0.05)).toBe(80);
    expect(scoreInsurance(0.15)).toBe(90);
  });

  it('健康区间内插值', () => {
    expect(scoreInsurance(0.075)).toBe(90);
    expect(scoreInsurance(0.125)).toBe(95);
  });

  it('偏低区间', () => {
    expect(scoreInsurance(0.03)).toBe(50);
    expect(scoreInsurance(0.04)).toBe(65);
    expect(scoreInsurance(0)).toBe(20);
  });

  it('偏高区间', () => {
    expect(scoreInsurance(0.2)).toBe(60);
    expect(scoreInsurance(0.175)).toBe(75);
    expect(scoreInsurance(0.3)).toBe(20);
  });
});

describe('分段连续性回归(所有评分函数在段边界无跳变)', () => {
  const eps = 1e-9;
  const expectContinuous = (name: string, fn: (x: number) => number, boundary: number) => {
    // 边界处取左右极限比较(取整后应相等,即无 10 分悬崖)
    const at = fn(boundary);
    const left = fn(boundary - eps);
    expect(at, `${name} 在 ${boundary} 处右值应等于左极限`).toBe(left);
  };

  it('应急能力在 3/6/12 月处连续', () => {
    [3, 6, 12].forEach((b) => expectContinuous('scoreEmergency', scoreEmergency, b));
  });

  it('偿债压力在 0.35/0.5 处连续', () => {
    [0.35, 0.5].forEach((b) => expectContinuous('scoreDebtBurden', scoreDebtBurden, b));
  });

  it('杠杆水平在 0.5/0.7 处连续', () => {
    [0.5, 0.7].forEach((b) => expectContinuous('scoreLeverage', scoreLeverage, b));
  });

  it('储蓄能力在 0.1/0.2/0.3/0.5 处连续', () => {
    [0.1, 0.2, 0.3, 0.5].forEach((b) => expectContinuous('scoreSavings', scoreSavings, b));
  });

  it('投资积累在 0.2/0.5/0.8 处连续', () => {
    [0.2, 0.5, 0.8].forEach((b) => expectContinuous('scoreInvestment', scoreInvestment, b));
  });

  it('财务自由度在 0.2/0.5/1 处连续', () => {
    [0.2, 0.5, 1].forEach((b) => expectContinuous('scoreFreedom', scoreFreedom, b));
  });

  it('保障充足度在 0.03/0.05/0.1/0.15/0.2/0.3 处连续', () => {
    [0.03, 0.05, 0.1, 0.15, 0.2, 0.3].forEach((b) => expectContinuous('scoreInsurance', scoreInsurance, b));
  });
});

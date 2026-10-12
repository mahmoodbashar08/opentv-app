
describe('withGoalBlock', () => {
  const { withGoalBlock, defaultLayout } = require('./profile-layout') as typeof import('./profile-layout');
  it('puts the goal wide, right after the counts, once', () => {
    const out = withGoalBlock(defaultLayout(['shows']));
    const i = out.findIndex((p) => p.id === 'counts');
    expect(out[i + 1]).toMatchObject({ id: 'goal', span: '2x1' });
    expect(withGoalBlock(out).filter((p) => p.id === 'goal')).toHaveLength(1);
  });
  it('leaves a goal the owner placed where it is', () => {
    const mine = [{ uid: 'g', id: 'goal', span: '1x1' as const }, { uid: 'c', id: 'counts', span: '2x1' as const }];
    expect(withGoalBlock(mine)).toEqual(mine);
  });
});

import { emptyStock, type Investments } from '../../src/investments/model.ts';
export const investmentFixture = (): Investments => ({
  schemaVersion: 1,
  revision: 0,
  portfolios: [
    {
      id: 'test-thesis',
      name: 'Synthetic infrastructure thesis',
      description: 'Synthetic test data only',
      horizon: '5 years',
      researchAsOf: '2026-10-19',
      relationships: 'Example demand → example supply',
      stocks: [
        {
          ...emptyStock(),
          id: 'example-stock',
          name: 'Example Semiconductor',
          symbol: 'TEST',
          exchange: 'NASDAQ',
          country: 'United States',
          currency: 'USD',
          theme: 'Equipment',
          targetWeight: 12.5,
          status: 'Review',
          thesis: 'Synthetic private memo',
          referenceSymbol: 'NASDAQ:TEST',
          brokerUrl: 'https://example.com/invest/TEST',
          sources: [{ label: 'Synthetic source', url: 'https://example.com/results' }],
        },
      ],
    },
  ],
});

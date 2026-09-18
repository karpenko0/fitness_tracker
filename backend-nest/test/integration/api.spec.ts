// === UPDATED TESTS FOR PROGRESS COMPARISON ENDPOINTS ===
  describe('Progress comparison endpoints', () => {
    it('should compare week over week for volume', async () => {
      // Mock data for current week (Sep 14-20, 2026) - sum = 12400
      // Mock data for previous week (Sep 7-13, 2026) - sum = 10800
      prisma.progressAggregate.findMany
        .mockResolvedValueOnce([ // Current week daily aggregates
          { value: 1500 }, { value: 1800 }, { value: 2000 }, { value: 2200 },
          { value: 1900 }, { value: 1500 }, { value: 1500 }
        ])
        .mockResolvedValueOnce([ // Previous week daily aggregates
          { value: 1400 }, { value: 1600 }, { value: 1500 }, { value: 1700 },
          { value: 1600 }, { value: 1500 }, { value: 1500 }
        ]);

      const response = await request(app.getHttpServer())
        .get('/api/v1/progress/compare')
        .query({ preset: 'WEEK', metric: 'VOLUME' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('metric', 'VOLUME');
      expect(response.body.data).toHaveProperty('unit', 'KG');
      expect(response.body.data.currentPeriod).toHaveProperty('value', 12400);
      expect(response.body.data.previousPeriod).toHaveProperty('value', 10800);
      expect(response.body.data.comparison).toHaveProperty('absoluteChange', 1600);
      expect(response.body.data.comparison).toHaveProperty('percentChange');
      expect(response.body.data.comparison.percentChange).toBeCloseTo(14.81, 2);
      expect(response.body.data.comparison).toHaveProperty('trend', 'UP');
      expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
    });

    it('should handle comparison with no previous data', async () => {
      // Mock data for current period only
      prisma.progressAggregate.findMany
        .mockResolvedValueOnce([ // Current period
          { value: 1500 }, { value: 1800 }
        ])
        .mockResolvedValueOnce([]); // Previous period - no data

      const response = await request(app.getHttpServer())
        .get('/api/v1/progress/compare')
        .query({ preset: 'WEEK', metric: 'VOLUME' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('metric', 'VOLUME');
      expect(response.body.data).toHaveProperty('unit', 'KG');
      expect(response.body.data.currentPeriod).toHaveProperty('value', 3300);
      expect(response.body.data.previousPeriod).toHaveProperty('value', null);
      expect(response.body.data.comparison).toHaveProperty('absoluteChange', null);
      expect(response.body.data.comparison).toHaveProperty('percentChange', null);
      expect(response.body.data.comparison).toHaveProperty('trend', 'NEUTRAL');
      expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
    });

    it('should respect Free/Pro restrictions for progress comparison (Free user limited to last 30 days)', async () => {
      // Mock data: recent aggregates (within 30 days) and old aggregates (more than 30 days ago)
      const recentAggregates = [
        { value: 1500 }, { value: 1800 }, { value: 2000 } // Sum = 5300
      ];
      const oldAggregates = [
        { value: 1000 }, { value: 1100 }, { value: 1200 } // Sum = 3300
      ];

      // For FREE user, only recent aggregates should be considered
      prisma.subscriptionEntitlement.findUnique.mockResolvedValueOnce({ plan: 'FREE' });
      prisma.progressAggregate.findMany
        .mockResolvedValueOnce(recentAggregates) // Current period
        .mockResolvedValueOnce(recentAggregates); // Previous period (also recent)

      let response = await request(app.getHttpServer())
        .get('/api/v1/progress/compare')
        .query({ preset: 'WEEK', metric: 'VOLUME' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      expect(response.body.data).toHaveProperty('metric', 'VOLUME');
      expect(response.body.data).toHaveProperty('unit', 'KG');
      expect(response.body.data.currentPeriod).toHaveProperty('value', 5300);
      expect(response.body.data.previousPeriod).toHaveProperty('value', 5300);
      expect(response.body.data.comparison).toHaveProperty('absoluteChange', 0);
      expect(response.body.data.comparison).toHaveProperty('percentChange', 0);
      expect(response.body.data.comparison).toHaveProperty('trend', 'NEUTRAL');
      expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);

      // For PRO user, both recent and old aggregates should be considered
      prisma.subscriptionEntitlement.findUnique.mockResolvedValueOnce({ plan: 'PRO' });
      // We'll simulate: current period = recent + old, previous period = old only
      prisma.progressAggregate.findMany
        .mockResolvedValueOnce([...recentAggregates, ...oldAggregates]) // Current period: recent + old
        .mockResolvedValueOnce(oldAggregates); // Previous period: old only

      response = await request(app.getHttpServer())
        .get('/api/v1/progress/compare')
        .query({ preset: 'WEEK', metric: 'VOLUME' })
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      // Current period sum: 1500+1800+2000+1000+1100+1200 = 8600
      // Previous period sum: 1000+1100+1200 = 3300
      expect(response.body.data).toHaveProperty('metric', 'VOLUME');
      expect(response.body.data).toHaveProperty('unit', 'KG');
      expect(response.body.data.currentPeriod).toHaveProperty('value', 8600);
      expect(response.body.data.previousPeriod).toHaveProperty('value', 3300);
      expect(response.body.data.comparison).toHaveProperty('absoluteChange', 5300);
      expect(response.body.data.comparison).toHaveProperty('percentChange');
      expect(response.body.data.comparison.percentChange).toBeCloseTo(160.61, 2);
      expect(response.body.data.comparison).toHaveProperty('trend', 'UP');
      expect(prisma.progressAggregate.findMany).toHaveBeenCalledTimes(2);
    });
  });
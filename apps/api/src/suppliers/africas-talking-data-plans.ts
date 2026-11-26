/**
 * Africa's Talking's published Mobile Data price list.
 *
 * Source checked 26 November 2026: https://africastalking.co.tz/pricing?lang=en
 * Only packages supported by the Mobile Data API's quantity/unit/validity contract are included. Admin-configured
 * plans override this list, so an account-specific schedule can replace it without a deployment.
 */

export const dataValidities = { Day: '1 day', Week: '7 days', BiWeek: '14 days', Month: '30 days', Quarterly: '90 days' } as const;
export type DataValidity = keyof typeof dataValidities;

export type AfricasTalkingDataPlan = {
  country: string;
  network: string;
  quantity: number;
  unit: 'MB' | 'GB';
  validity: DataValidity;
  /** The bundle's retail face price and Africa's Talking's published charge, both in the market currency. */
  price: string;
  cost: string;
};

const plan = (country: string, network: string, quantity: number, unit: 'MB' | 'GB', validity: DataValidity, price: number, cost: number): AfricasTalkingDataPlan =>
  ({ country, network, quantity, unit, validity, price: String(price), cost: String(cost) });

export const publishedAfricasTalkingDataPlans: readonly AfricasTalkingDataPlan[] = [
  plan('KE', 'safaricom', 50, 'MB', 'Day', 10, 10),
  plan('KE', 'safaricom', 100, 'MB', 'Day', 20, 20),
  plan('KE', 'safaricom', 250, 'MB', 'Day', 50, 50),
  plan('KE', 'safaricom', 500, 'MB', 'Day', 100, 100),
  plan('KE', 'safaricom', 1, 'GB', 'Week', 205, 205),

  plan('NG', 'glo', 40, 'MB', 'Day', 50, 48.75),
  plan('NG', 'glo', 120, 'MB', 'Day', 100, 97.5),
  plan('NG', 'glo', 200, 'MB', 'Week', 50, 48.75),
  plan('NG', 'glo', 550, 'MB', 'Week', 500, 487.5),
  plan('NG', 'glo', 1.7, 'GB', 'Week', 1000, 975),
  plan('NG', 'glo', 500, 'MB', 'Month', 100, 97.5),
  plan('NG', 'glo', 2, 'GB', 'Month', 1500, 1462.5),
  plan('NG', 'glo', 4.25, 'GB', 'Month', 2500, 2437.5),
  plan('NG', 'glo', 6.5, 'GB', 'Month', 2000, 1950),
  plan('NG', 'glo', 8.5, 'GB', 'Month', 3000, 2925),
  plan('NG', 'glo', 10.5, 'GB', 'Month', 4000, 3900),
  plan('NG', 'glo', 14.5, 'GB', 'Month', 5000, 4875),
  plan('NG', 'glo', 26, 'GB', 'Month', 8000, 7800),
  plan('NG', 'glo', 38, 'GB', 'Month', 10000, 9750),
  plan('NG', 'glo', 62, 'GB', 'Month', 15000, 14625),
  plan('NG', 'glo', 105, 'GB', 'Month', 20000, 19500),
  plan('NG', 'glo', 165, 'GB', 'Month', 30000, 29250),
  plan('NG', 'glo', 355, 'GB', 'Month', 60000, 58500),
  plan('NG', 'glo', 475, 'GB', 'Month', 75000, 73125),

  plan('NG', 'mtn', 75, 'MB', 'Day', 75, 73.5),
  plan('NG', 'mtn', 110, 'MB', 'Day', 100, 98),
  plan('NG', 'mtn', 230, 'MB', 'Day', 200, 196),
  plan('NG', 'mtn', 500, 'MB', 'Day', 350, 343),
  plan('NG', 'mtn', 1, 'GB', 'Day', 500, 490),
  plan('NG', 'mtn', 2.5, 'GB', 'Day', 750, 735),
  plan('NG', 'mtn', 500, 'MB', 'Week', 500, 490),
  plan('NG', 'mtn', 600, 'MB', 'Week', 500, 490),
  plan('NG', 'mtn', 1, 'GB', 'Week', 800, 784),
  plan('NG', 'mtn', 1.5, 'GB', 'Week', 1000, 980),
  plan('NG', 'mtn', 3.5, 'GB', 'Week', 1500, 1470),
  plan('NG', 'mtn', 6, 'GB', 'Week', 2500, 2450),
  plan('NG', 'mtn', 11, 'GB', 'Week', 3500, 3430),
  plan('NG', 'mtn', 20, 'GB', 'Week', 5000, 4900),
  plan('NG', 'mtn', 1.8, 'GB', 'Month', 1500, 1470),
  plan('NG', 'mtn', 5.5, 'GB', 'Month', 3000, 2940),
  plan('NG', 'mtn', 6.75, 'GB', 'Month', 3000, 2940),
  plan('NG', 'mtn', 7, 'GB', 'Month', 3500, 3430),
  plan('NG', 'mtn', 10, 'GB', 'Month', 4500, 4410),
  plan('NG', 'mtn', 12.5, 'GB', 'Month', 5500, 5390),
  plan('NG', 'mtn', 14.5, 'GB', 'Month', 5000, 4900),
  plan('NG', 'mtn', 16.5, 'GB', 'Month', 6500, 6370),
  plan('NG', 'mtn', 20, 'GB', 'Month', 7500, 7350),
  plan('NG', 'mtn', 25, 'GB', 'Month', 7500, 7350),
  plan('NG', 'mtn', 36, 'GB', 'Month', 11000, 10780),
  plan('NG', 'mtn', 65, 'GB', 'Month', 16000, 15680),
  plan('NG', 'mtn', 75, 'GB', 'Month', 18000, 17460),
  plan('NG', 'mtn', 165, 'GB', 'Month', 35000, 34300),
  plan('NG', 'mtn', 480, 'GB', 'Quarterly', 90000, 88200),

  plan('NG', 'airtel', 75, 'MB', 'Day', 75, 73.41),
  plan('NG', 'airtel', 110, 'MB', 'Day', 100, 97.91),
  plan('NG', 'airtel', 230, 'MB', 'Day', 200, 195.91),
  plan('NG', 'airtel', 300, 'MB', 'Day', 300, 293.91),
  plan('NG', 'airtel', 500, 'MB', 'Day', 350, 342.92),
  plan('NG', 'airtel', 500, 'MB', 'Week', 500, 489.92),
  plan('NG', 'airtel', 1, 'GB', 'Week', 800, 783.91),
  plan('NG', 'airtel', 1.5, 'GB', 'Week', 1000, 979.92),
  plan('NG', 'airtel', 4, 'GB', 'Week', 1500, 1469.92),
  plan('NG', 'airtel', 6, 'GB', 'Week', 2000, 1959.93),
  plan('NG', 'airtel', 8, 'GB', 'Week', 2500, 2449.91),
  plan('NG', 'airtel', 10, 'GB', 'Week', 3000, 2939.91),
  plan('NG', 'airtel', 20, 'GB', 'Week', 5000, 4899.91),
  plan('NG', 'airtel', 2, 'GB', 'Month', 1500, 1469.93),
  plan('NG', 'airtel', 3, 'GB', 'Month', 2000, 1959.91),
  plan('NG', 'airtel', 4, 'GB', 'Month', 2500, 2449.92),
  plan('NG', 'airtel', 8, 'GB', 'Month', 3000, 2939.92),
  plan('NG', 'airtel', 10, 'GB', 'Month', 4000, 3919.91),
  plan('NG', 'airtel', 13, 'GB', 'Month', 5000, 4899.92),
  plan('NG', 'airtel', 18, 'GB', 'Month', 6000, 5879.91),
  plan('NG', 'airtel', 25, 'GB', 'Month', 8000, 7839.91),
  plan('NG', 'airtel', 35, 'GB', 'Month', 10000, 9799.91),
  plan('NG', 'airtel', 60, 'GB', 'Month', 15000, 14699.91),
  plan('NG', 'airtel', 100, 'GB', 'Month', 20000, 19599.91),
  plan('NG', 'airtel', 160, 'GB', 'Month', 30000, 29399.91),
  plan('NG', 'airtel', 210, 'GB', 'Month', 40000, 39199.91),
  plan('NG', 'airtel', 300, 'GB', 'Quarterly', 50000, 48999.91),
  plan('NG', 'airtel', 350, 'GB', 'Quarterly', 60000, 58799.91),
  plan('NG', 'airtel', 680, 'GB', 'Quarterly', 100000, 97999.91),

  plan('NG', '9mobile', 40, 'MB', 'Day', 50, 48.25),
  plan('NG', '9mobile', 83, 'MB', 'Day', 100, 96.5),
  plan('NG', '9mobile', 250, 'MB', 'Day', 200, 193),
  plan('NG', '9mobile', 3.4, 'GB', 'Week', 1500, 1447.5),
  plan('NG', '9mobile', 2, 'GB', 'Month', 1000, 965),
  plan('NG', '9mobile', 2.3, 'GB', 'Month', 1200, 1158),
  plan('NG', '9mobile', 4.5, 'GB', 'Month', 2000, 1930),
  plan('NG', '9mobile', 5.2, 'GB', 'Month', 2500, 2412),
  plan('NG', '9mobile', 6.2, 'GB', 'Month', 3000, 2895),
  plan('NG', '9mobile', 8.4, 'GB', 'Month', 4000, 3860),
  plan('NG', '9mobile', 11.4, 'GB', 'Month', 5000, 4825),
];

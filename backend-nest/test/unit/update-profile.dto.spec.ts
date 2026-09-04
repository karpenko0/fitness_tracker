import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateProfileDto } from '../../src/user/dto/update-profile.dto';

describe('UpdateProfileDto', () => {
  async function validationErrors(input: Record<string, unknown>) {
    return validate(plainToInstance(UpdateProfileDto, input));
  }

  it.each([
    [{ heightCm: 99 }],
    [{ weightKg: 24 }],
    [{ birthDate: '2026-99-99' }],
    [{ timezone: 'Mars/Olympus' }],
    [{ gender: 'UNKNOWN' }],
  ])('rejects invalid profile data: %j', async (input) => {
    await expect(validationErrors(input)).resolves.not.toHaveLength(0);
  });

  it('accepts null optional fields and empty preference arrays', async () => {
    const errors = await validationErrors({
      birthDate: null,
      heightCm: null,
      weightKg: null,
      equipment: [],
      trainingPreferences: [],
      notificationDays: [],
      timezone: 'Europe/Moscow',
    });

    expect(errors).toHaveLength(0);
  });
});

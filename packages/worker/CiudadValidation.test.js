import { validateCityName } from '../src/utils/CiudadValidation';

describe('CiudadValidation', () => {
    describe('validateCityName', () => {
        test('should return true for valid city names containing letters, spaces, hyphens, and apostrophes', () => {
            expect(validateCityName('Madrid')).toBe(true);
            expect(validateCityName('New York')).toBe(true);
            expect(validateCityName('Saint-Paul')).toBe(true);
            expect(validateCityName("O'Connor")).toBe(true);
            expect(validateCityName('São Paulo')).toBe(true);
            expect(validateCityName('México D.F.')).toBe(true);
            expect(validateCityName('Los Angeles')).toBe(true);
            expect(validateCityName('Buenos Aires')).toBe(true);
        });

        test('should return false for city names containing the @ symbol', () => {
            expect(validateCityName('Madrid@')).toBe(false);
            expect(validateCityName('@Madrid')).toBe(false);
            expect(validateCityName('New @ York')).toBe(false);
            expect(validateCityName('City@2024')).toBe(false);
            expect(validateCityName('Bilbao @2024')).toBe(false);
            expect(validateCityName('@')).toBe(false);
            expect(validateCityName('Test@')).toBe(false);
        });

        test('should return false for city names containing numeric digits', () => {
            expect(validateCityName('Madrid1')).toBe(false);
            expect(validateCityName('123')).toBe(false);
            expect(validateCityName('City123')).toBe(false);
            expect(validateCityName('New York 2')).toBe(false);
        });

        test('should return false for city names containing other special characters', () => {
            expect(validateCityName('Madrid!')).toBe(false);
            expect(validateCityName('New.York')).toBe(false);
            expect(validateCityName('City#Name')).toBe(false);
            expect(validateCityName('Test$City')).toBe(false);
            expect(validateCityName('Name%Here')).toBe(false);
            expect(validateCityName('City^Town')).toBe(false);
            expect(validateCityName('Place&Location')).toBe(false);
            expect(validateCityName('Site*Area')).toBe(false);
        });

        test('should return false for empty string', () => {
            expect(validateCityName('')).toBe(false);
        });

        test('should return false for null or undefined', () => {
            expect(validateCityName(null)).toBe(false);
            expect(validateCityName(undefined)).toBe(false);
        });

        test('should return true for city names with only allowed characters in various combinations', () => {
            expect(validateCityName('A-B')).toBe(true);
            expect(validateCityName('A B')).toBe(true);
            expect(validateCityName("A'B")).toBe(true);
            expect(validateCityName('A-B C')).toBe(true);
            expect(validateCityName("A'B-C")).toBe(true);
            expect(validateCityName('A B-C')).toBe(true);
        });
    });
});
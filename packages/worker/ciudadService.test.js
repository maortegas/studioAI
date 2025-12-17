const ciudadService = require('../src/services/ciudadService');

describe('ciudadService', () => {
    describe('handleResponse', () => {
        test('should extract error message from JSON response body for 400 status', () => {
            const mockResponse = {
                status: 400,
                json: jest.fn().mockResolvedValue({ error: 'City name can only contain letters, spaces, hyphens, and apostrophes.' }),
                text: jest.fn().mockResolvedValue('{"error": "City name can only contain letters, spaces, hyphens, and apostrophes."}')
            };

            return ciudadService.handleResponse(mockResponse).catch(error => {
                expect(error.message).toBe('City name can only contain letters, spaces, hyphens, and apostrophes.');
            });
        });

        test('should use default error message when JSON parsing fails for 400 status', () => {
            const mockResponse = {
                status: 400,
                json: jest.fn().mockRejectedValue(new Error('Invalid JSON')),
                text: jest.fn().mockResolvedValue('Invalid response')
            };

            return ciudadService.handleResponse(mockResponse).catch(error => {
                expect(error.message).toBe('Bad Request');
            });
        });

        test('should use default error message when error field is missing in JSON for 400 status', () => {
            const mockResponse = {
                status: 400,
                json: jest.fn().mockResolvedValue({ message: 'Some other error' }),
                text: jest.fn().mockResolvedValue('{"message": "Some other error"}')
            };

            return ciudadService.handleResponse(mockResponse).catch(error => {
                expect(error.message).toBe('Bad Request');
            });
        });

        test('should resolve successfully for non-error status codes', () => {
            const mockResponse = {
                status: 200,
                json: jest.fn().mockResolvedValue({ data: 'success' })
            };

            return expect(ciudadService.handleResponse(mockResponse)).resolves.toEqual({ data: 'success' });
        });

        test('should reject with default error message for other error status codes', () => {
            const mockResponse = {
                status: 500,
                json: jest.fn().mockResolvedValue({}),
                text: jest.fn().mockResolvedValue('')
            };

            return ciudadService.handleResponse(mockResponse).catch(error => {
                expect(error.message).toBe('Internal Server Error');
            });
        });
    });

    describe('createCiudad', () => {
        test('should call fetch with correct parameters and handle response', async () => {
            const mockCiudad = { nombre: 'Madrid', poblacion: 3200000 };
            const mockResponse = {
                status: 201,
                json: jest.fn().mockResolvedValue(mockCiudad)
            };

            global.fetch = jest.fn().mockResolvedValue(mockResponse);

            const result = await ciudadService.createCiudad(mockCiudad);

            expect(global.fetch).toHaveBeenCalledWith('/api/ciudades', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mockCiudad)
            });
            expect(result).toEqual(mockCiudad);
        });

        test('should reject when creating ciudad with invalid name containing @', async () => {
            const mockCiudad = { nombre: 'Madrid@2024', poblacion: 3200000 };
            const mockResponse = {
                status: 400,
                json: jest.fn().mockResolvedValue({ error: 'City name can only contain letters, spaces, hyphens, and apostrophes.' }),
                text: jest.fn().mockResolvedValue('{"error": "City name can only contain letters, spaces, hyphens, and apostrophes."}')
            };

            global.fetch = jest.fn().mockResolvedValue(mockResponse);

            await expect(ciudadService.createCiudad(mockCiudad)).rejects.toThrow(
                'City name can only contain letters, spaces, hyphens, and apostrophes.'
            );
        });
    });

    describe('updateCiudad', () => {
        test('should call fetch with correct parameters and handle response', async () => {
            const id = 1;
            const mockCiudad = { nombre: 'Madrid', poblacion: 3200000 };
            const mockResponse = {
                status: 200,
                json: jest.fn().mockResolvedValue(mockCiudad)
            };

            global.fetch = jest.fn().mockResolvedValue(mockResponse);

            const result = await ciudadService.updateCiudad(id, mockCiudad);

            expect(global.fetch).toHaveBeenCalledWith(`/api/ciudades/${id}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(mockCiudad)
            });
            expect(result).toEqual(mockCiudad);
        });

        test('should reject when updating ciudad with invalid name containing @', async () => {
            const id = 1;
            const mockCiudad = { nombre: 'Bilbao @2024', poblacion: 350000 };
            const mockResponse = {
                status: 400,
                json: jest.fn().mockResolvedValue({ error: 'City name can only contain letters, spaces, hyphens, and apostrophes.' }),
                text: jest.fn().mockResolvedValue('{"error": "City name can only contain letters, spaces, hyphens, and apostrophes."}')
            };

            global.fetch = jest.fn().mockResolvedValue(mockResponse);

            await expect(ciudadService.updateCiudad(id, mockCiudad)).rejects.toThrow(
                'City name can only contain letters, spaces, hyphens, and apostrophes.'
            );
        });
    });
});
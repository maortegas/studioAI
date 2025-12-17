package com.example.ciudades.service;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.DisplayName;
import static org.junit.jupiter.api.Assertions.*;

class CiudadServiceTest {

    private final CiudadService ciudadService = new CiudadService();

    @Test
    @DisplayName("Should accept city names with letters, spaces, hyphens, and apostrophes")
    void validateCityNameCharacters_ShouldAcceptValidCharacters() {
        // Test cases with valid characters
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters("Madrid"));
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters("New York"));
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters("Saint-Paul"));
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters("O'Connor"));
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters("São Paulo"));
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters("México D.F."));
    }

    @Test
    @DisplayName("Should reject city names containing the '@' symbol")
    void validateCityNameCharacters_ShouldRejectAtSymbol() {
        // Test various positions of '@' symbol
        IllegalArgumentException exception1 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("Madrid@"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception1.getMessage());

        IllegalArgumentException exception2 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("@Madrid"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception2.getMessage());

        IllegalArgumentException exception3 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("New @ York"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception3.getMessage());

        IllegalArgumentException exception4 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("city@2024"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception4.getMessage());
    }

    @Test
    @DisplayName("Should reject city names containing numeric digits")
    void validateCityNameCharacters_ShouldRejectNumericDigits() {
        // Existing validation - should still reject numbers
        IllegalArgumentException exception1 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("Madrid1"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception1.getMessage());

        IllegalArgumentException exception2 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("123"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception2.getMessage());
    }

    @Test
    @DisplayName("Should reject city names containing special characters other than hyphens and apostrophes")
    void validateCityNameCharacters_ShouldRejectOtherSpecialCharacters() {
        // Test other invalid characters
        IllegalArgumentException exception1 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("Madrid!"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception1.getMessage());

        IllegalArgumentException exception2 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("New.York"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception2.getMessage());

        IllegalArgumentException exception3 = assertThrows(IllegalArgumentException.class,
            () -> ciudadService.validateCityNameCharacters("City#Name"));
        assertEquals("City name can only contain letters, spaces, hyphens, and apostrophes.", exception3.getMessage());
    }

    @Test
    @DisplayName("Should accept empty and null city names without throwing exception")
    void validateCityNameCharacters_ShouldHandleEmptyAndNull() {
        // Assuming the method handles empty/null gracefully or as per business logic
        // Adjust based on actual implementation
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters(""));
        assertDoesNotThrow(() -> ciudadService.validateCityNameCharacters(null));
    }
}
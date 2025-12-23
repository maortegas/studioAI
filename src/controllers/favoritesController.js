const favoritesService = require('../services/favoritesService');

/**
 * Add a favorite
 * POST /api/favorites
 * Body: { userId, contentId }
 * Returns: 201 on success, 409 if already exists, 500 on error
 */
const add = async (req, res) => {
  try {
    const { userId, contentId } = req.body;

    if (!userId || !contentId) {
      return res.status(400).json({ error: 'userId and contentId are required' });
    }

    const result = await favoritesService.add(userId, contentId);
    
    if (result.error) {
      if (result.error === 'Favorite already exists') {
        return res.status(409).json({ error: result.error });
      }
      return res.status(500).json({ error: result.error });
    }

    return res.status(201).json(result);
  } catch (error) {
    console.error('Error in favoritesController.add:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Remove a favorite
 * DELETE /api/favorites/:userId/:contentId
 * Returns: 200 on success, 404 if not found, 500 on error
 */
const remove = async (req, res) => {
  try {
    const { userId, contentId } = req.params;

    if (!userId || !contentId) {
      return res.status(400).json({ error: 'userId and contentId are required' });
    }

    const result = await favoritesService.remove(userId, contentId);

    if (result.error) {
      if (result.error === 'Favorite not found') {
        return res.status(404).json({ error: result.error });
      }
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in favoritesController.remove:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get all favorites for a user
 * GET /api/favorites/:userId
 * Returns: 200 with favorites array, 404 if user not found, 500 on error
 */
const get = async (req, res) => {
  try {
    const { userId } = req.params;

    if (!userId) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const result = await favoritesService.get(userId);

    if (result.error) {
      if (result.error === 'User not found') {
        return res.status(404).json({ error: result.error });
      }
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in favoritesController.get:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Check if a favorite exists
 * GET /api/favorites/:userId/:contentId
 * Returns: 200 with { isFavorite: boolean }, 404 if user not found, 500 on error
 */
const check = async (req, res) => {
  try {
    const { userId, contentId } = req.params;

    if (!userId || !contentId) {
      return res.status(400).json({ error: 'userId and contentId are required' });
    }

    const result = await favoritesService.check(userId, contentId);

    if (result.error) {
      if (result.error === 'User not found') {
        return res.status(404).json({ error: result.error });
      }
      return res.status(500).json({ error: result.error });
    }

    return res.status(200).json(result);
  } catch (error) {
    console.error('Error in favoritesController.check:', error);
    return res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

module.exports = {
  add,
  remove,
  get,
  check,
};


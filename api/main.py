from fastapi import FastAPI

app = FastAPI()

@app.get("/test")
def test():
    return {"message": "API Python fonctionne"}

from fastapi import FastAPI

app = FastAPI()

# Endpoint de test existant
@app.get("/test")
def read_test():
    return {"message": "API Python fonctionne"}

# Nouveau endpoint "pollution"
@app.get("/pollution")
def get_pollution():
    # On renvoie des données fictives pour le test
    return {
        "ville": "Lyon",
        "pollution": {
            "PM2.5": 12.3,
            "NO2": 24.7,
            "O3": 18.9
        }
    }
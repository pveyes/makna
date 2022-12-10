
import fs from 'fs'

const words = fs.readdirSync("./data").map(file => {
    return file.replace(".json","")
}).filter(word => {
    return word.length === 5
})

fs.writeFileSync("./words.json", JSON.stringify(words))
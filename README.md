# VExcess Academy
An open source website where anyone can learn computer science for free and share programs in various languages with the community.

## Running Locally
Clone the repo.  
You will then need to install all the npm modules.  
VExcess Academy requires Node JS v15.8.0 or higher to run and the server can be started with `node index.js`.  
You also need to assign values to the following variables in `src/index.js` or else the server will crash: `process.env.MASTER_KEY` and `process.env.RECAPTCHA_KEY`.  
`MASTER_KEY` is the encryption key used to encrypt profiles and stuff.  
`RECAPTCHA_KEY` is the key for validating the Google Recaptcha on the sign up page.  
For the code editor to work you will also need to run the execution environment sandbox server located in `sandbox/index.js`.  
You'll then need to change the URL in `src/pages/computer-programming/program.js` to use your localhost URL instead of the official one.  

## Contributors
[VExcess](https://github.com/vExcess) - I wrote nearly all the code  
[WKoA](https://github.com/Reginald-Gillespie) - Helped find bugs and vulnerabilities  
[Archbirdplus](https://github.com/archbirdplus) - Helped find bugs and vulnerabilities  
[Dat](https://github.com/Dddatt) - Wrote the WebGL tutorial  
[WalkWorthy](https://github.com/RandomLegoBrick) - Created the Java runtime iso  
[Shipment](https://github.com/Shipment22) - Helped with CSS & Father of the Bobert avatar  
[CylenceScythe](https://www.khanacademy.org/profile/SharleyBoo) - Created Pyro avatar graphics  
[Leslie](https://www.khanacademy.org/profile/ForeverFrostine) - Created Floof avatar graphics  

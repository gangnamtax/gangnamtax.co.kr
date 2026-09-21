const loginform = document.querySelector("#loginform");
const logininput = document.querySelector("#loginform input");
const greetingheader = document.querySelector("#greeting");

loginform.addEventListener("submit", getname);


function getname(parm) {

    parm.preventDefault();
    
    const username = logininput.value;
    loginform.style.display = "none";

    greetingheader.innerHTML = "안녕하세요." + username + "님";

    localStorage.setItem("myusername", username);


}

const stored_username = localStorage.getItem("myusername");
if (stored_username === null) {
    //stored_username이 없을 때

}
else {    

    //stored_username이 있을 때
    loginform.style.display = "none";
    greetingheader.innerHTML = "안녕하세요." + stored_username + "님";

}    